import { ok, fail } from '../lib/apiResponse.js';
import { updateSettingsSchema } from '../validators/settings.validators.js';
import { Setting } from '../models/Setting.js';
import { audit } from '../models/AuditLog.js';
import { saveCompanyLogo, saveBackground, deleteLogoFile } from '../lib/brand.js';

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
