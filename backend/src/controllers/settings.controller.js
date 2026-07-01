import { ok, fail } from '../lib/apiResponse.js';
import { updateSettingsSchema, updateSmtpSchema } from '../validators/settings.validators.js';
import { Setting } from '../models/Setting.js';
import { User } from '../models/User.js';
import { audit } from '../models/AuditLog.js';
import { saveCompanyLogo, saveBackground, deleteLogoFile } from '../lib/brand.js';
import { verifyPassword } from '../lib/password.js';
import { encryptSecret } from '../lib/secretBox.js';
import { sendTestEmail } from '../lib/mailer.js';

/** Re-auth guard: confirm the caller's own account password before a sensitive change. */
async function requireReauth(req, currentPassword) {
  const fresh = await User.findById(req.user._id).select('+passwordHash');
  if (!fresh) throw Object.assign(new Error('User not found'), { status: 404, code: 'NOT_FOUND' });
  const good = currentPassword && (await verifyPassword(currentPassword, fresh.passwordHash));
  if (!good) throw Object.assign(new Error('Your account password is incorrect'), { status: 403, code: 'BAD_PASSWORD' });
}

/** Back-fill: an earlier single logo (logoUrl) becomes the dark-theme logo. */
function backfillLogos(s) {
  if (!s.logoDark && s.logoUrl) {
    s.logoDark = s.logoUrl;
    return true;
  }
  return false;
}

export async function getSettings(_req, res, next) {
  try {
    const s = await Setting.getSingleton();
    if (backfillLogos(s)) await s.save();
    res.json(ok({ settings: s.toJSON() }));
  } catch (err) {
    next(err);
  }
}

/** PUBLIC branding subset (logo + name + colour) — safe to expose; used by the
 * unauthenticated login page so it can show the right theme-aware logo. */
export async function getBranding(_req, res, next) {
  try {
    const s = await Setting.getSingleton();
    if (backfillLogos(s)) await s.save();
    res.json(
      ok({
        branding: {
          companyName: s.companyName,
          logoLight: s.logoLight,
          logoDark: s.logoDark,
          logoUrl: s.logoUrl,
          brandColor: s.brandColor,
        },
      }),
    );
  } catch (err) {
    next(err);
  }
}

export async function updateSettings(req, res, next) {
  try {
    const body = updateSettingsSchema.parse(req.body);
    const s = await Setting.getSingleton();
    Object.assign(s, body);
    await s.save();
    await audit({ actor: req.user._id, action: 'settings.update', entityType: 'Setting', entityId: 'global', meta: body });
    res.json(ok({ settings: s.toJSON() }));
  } catch (err) {
    next(err);
  }
}

/**
 * Configure the outgoing email (SMTP) account. Write-only for the password: it's
 * encrypted at rest and never returned to the client. Requires the caller to
 * re-enter their own account password.
 */
export async function updateSmtp(req, res, next) {
  try {
    const body = updateSmtpSchema.parse(req.body);
    await requireReauth(req, body.currentPassword);

    const s = await Setting.getSingleton();
    s.smtpUser = body.smtpUser.trim();
    s.smtpHost = (body.smtpHost || '').trim();
    s.smtpPort = body.smtpPort || 0;
    // Only replace the stored password when a new one is supplied (write-only).
    if (body.smtpPass) s.smtpPassEnc = encryptSecret(body.smtpPass);
    await s.save();

    // Never log the secret — audit records only the non-secret fields.
    await audit({
      actor: req.user._id,
      action: 'settings.smtp.update',
      entityType: 'Setting',
      entityId: 'global',
      meta: { smtpUser: s.smtpUser, smtpHost: s.smtpHost, smtpPort: s.smtpPort, passwordChanged: !!body.smtpPass },
    });
    res.json(ok({ settings: s.toJSON() }));
  } catch (err) {
    if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
    next(err);
  }
}

/** Revert to the environment-based SMTP config (clears the stored account). */
export async function clearSmtp(req, res, next) {
  try {
    await requireReauth(req, req.body?.currentPassword);
    const s = await Setting.getSingleton();
    s.smtpUser = '';
    s.smtpPassEnc = '';
    s.smtpHost = '';
    s.smtpPort = 0;
    await s.save();
    await audit({ actor: req.user._id, action: 'settings.smtp.clear', entityType: 'Setting', entityId: 'global' });
    res.json(ok({ settings: s.toJSON() }));
  } catch (err) {
    if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
    next(err);
  }
}

/** Send a test email to the caller's own address using the current config. */
export async function testSmtp(req, res, next) {
  try {
    const to = req.user.email;
    if (!to) return res.status(400).json(fail('NO_EMAIL', 'Your account has no email address'));
    const s = await Setting.getSingleton();
    const result = await sendTestEmail(to, s.companyName);
    if (!result.delivered) {
      return res.status(400).json(fail('SMTP_NOT_CONFIGURED', 'Email is not configured yet — save your SMTP settings first.'));
    }
    res.json(ok({ delivered: true, to }));
  } catch (err) {
    // Surface the real SMTP/auth error so the admin can fix the credentials.
    const msg = err?.response || err?.message || 'Could not send the test email';
    return res.status(400).json(fail('SMTP_TEST_FAILED', String(msg).slice(0, 300)));
  }
}

/** Upload/replace a company logo variant ('light' or 'dark'). */
export async function uploadLogo(req, res, next) {
  try {
    const { dataUrl } = req.body || {};
    const variant = req.body?.variant === 'light' ? 'light' : 'dark';
    if (!dataUrl) return res.status(400).json(fail('NO_IMAGE', 'No image provided'));

    const url = saveCompanyLogo(dataUrl, Date.now(), variant);
    const s = await Setting.getSingleton();
    const field = variant === 'light' ? 'logoLight' : 'logoDark';
    deleteLogoFile(s[field]); // drop the previous file for this variant
    s[field] = url;
    if (variant === 'dark') s.logoUrl = url; // keep legacy mirror in sync
    await s.save();
    await audit({ actor: req.user._id, action: 'settings.logo.upload', entityType: 'Setting', entityId: 'global', meta: { variant, url } });
    res.json(ok({ settings: s.toJSON() }));
  } catch (err) {
    if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
    next(err);
  }
}

/** Remove a company logo variant ('light' or 'dark'). */
export async function removeLogo(req, res, next) {
  try {
    const variant = req.query?.variant === 'light' ? 'light' : 'dark';
    const s = await Setting.getSingleton();
    const field = variant === 'light' ? 'logoLight' : 'logoDark';
    deleteLogoFile(s[field]);
    s[field] = '';
    if (variant === 'dark') s.logoUrl = '';
    await s.save();
    await audit({ actor: req.user._id, action: 'settings.logo.remove', entityType: 'Setting', entityId: 'global', meta: { variant } });
    res.json(ok({ settings: s.toJSON() }));
  } catch (err) {
    next(err);
  }
}

/** Upload/replace an app background variant ('light' or 'dark'). */
export async function uploadBackground(req, res, next) {
  try {
    const { dataUrl } = req.body || {};
    const variant = req.body?.variant === 'light' ? 'light' : 'dark';
    if (!dataUrl) return res.status(400).json(fail('NO_IMAGE', 'No image provided'));

    const url = saveBackground(dataUrl, Date.now(), variant);
    const s = await Setting.getSingleton();
    const field = variant === 'light' ? 'bgLight' : 'bgDark';
    deleteLogoFile(s[field]);
    s[field] = url;
    await s.save();
    await audit({ actor: req.user._id, action: 'settings.bg.upload', entityType: 'Setting', entityId: 'global', meta: { variant, url } });
    res.json(ok({ settings: s.toJSON() }));
  } catch (err) {
    if (err && err.status) return res.status(err.status).json(fail(err.code || 'ERROR', err.message));
    next(err);
  }
}

/** Remove an app background variant ('light' or 'dark'). */
export async function removeBackground(req, res, next) {
  try {
    const variant = req.query?.variant === 'light' ? 'light' : 'dark';
    const s = await Setting.getSingleton();
    const field = variant === 'light' ? 'bgLight' : 'bgDark';
    deleteLogoFile(s[field]);
    s[field] = '';
    await s.save();
    await audit({ actor: req.user._id, action: 'settings.bg.remove', entityType: 'Setting', entityId: 'global', meta: { variant } });
    res.json(ok({ settings: s.toJSON() }));
  } catch (err) {
    next(err);
  }
}
