import nodemailer from 'nodemailer';
import { Setting } from '../models/Setting.js';
import { decryptSecret } from './secretBox.js';

let cached = null; // { sig, transporter } — rebuilt automatically when config changes

/**
 * Resolve the SMTP config. Settings (DB) win when a full credential pair is
 * stored there; otherwise fall back to the SMTP_* environment variables. Host
 * and port default to Gmail. The stored app-password is decrypted here and
 * never leaves the server.
 */
async function resolveConfig() {
  let s = null;
  try {
    s = await Setting.getSingleton();
  } catch {
    /* DB unavailable — fall back to env */
  }
  const dbUser = (s?.smtpUser || '').trim();
  let dbPass = '';
  if (s?.smtpPassEnc) {
    const dec = decryptSecret(s.smtpPassEnc);
    if (dec === null) {
      // A password IS stored but won't decrypt (key changed / corruption). Don't
      // silently switch credentials — surface it so it gets re-entered.
      console.warn(
        '⚠️  Stored SMTP password could not be decrypted (encryption key changed?) — ' +
          'falling back to SMTP_* env vars. Re-save the email settings to fix.',
      );
    } else {
      dbPass = dec;
    }
  }
  const useDb = !!(dbUser && dbPass);

  const user = useDb ? dbUser : process.env.SMTP_USER || '';
  const pass = useDb ? dbPass : process.env.SMTP_PASS || '';
  const host = (s?.smtpHost || '').trim() || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(s?.smtpPort || process.env.SMTP_PORT || 587);
  const companyName = s?.companyName || 'Office Management';

  return { user, pass, host, port, companyName, configured: !!(user && pass && host) };
}

/** Build (or reuse) a transporter for the current config. Null if unconfigured. */
async function getConnection() {
  const cfg = await resolveConfig();
  if (!cfg.configured) return null;
  const sig = `${cfg.host}|${cfg.port}|${cfg.user}|${cfg.pass}`;
  if (!cached || cached.sig !== sig) {
    cached = {
      sig,
      transporter: nodemailer.createTransport({
        host: cfg.host,
        port: cfg.port,
        secure: cfg.port === 465,
        auth: { user: cfg.user, pass: cfg.pass },
      }),
    };
  }
  return { transporter: cached.transporter, cfg };
}

/** "Company Name <sender@domain>" using the authenticated account for the address. */
function fromAddress(name, user) {
  if (user) return `${name || 'Office Management'} <${user}>`;
  return process.env.SMTP_FROM || 'Office Management <no-reply@example.com>';
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** A clean, email-safe (inline-styled, table-based) password-reset email. */
function resetEmailHtml(company, resetUrl) {
  const name = esc(company);
  const url = esc(resetUrl);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
        <tr><td style="padding:22px 28px 0;">
          <p style="margin:0;font-size:13px;font-weight:600;letter-spacing:.02em;color:#6b7280;text-transform:uppercase;">${name}</p>
        </td></tr>
        <tr><td style="padding:10px 28px 0;">
          <h1 style="margin:0;font-size:20px;line-height:1.3;color:#111827;font-weight:600;">Reset your password</h1>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#374151;">We received a request to reset your password. Click the button below to choose a new one.</p>
        </td></tr>
        <tr><td style="padding:22px 28px 4px;" align="center">
          <a href="${url}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 26px;border-radius:10px;">Reset password</a>
        </td></tr>
        <tr><td style="padding:8px 28px 0;" align="center">
          <p style="margin:0;font-size:13px;color:#6b7280;">This link expires in about 30 minutes.</p>
        </td></tr>
        <tr><td style="padding:20px 28px;">
          <div style="border-top:1px solid #eef0f2;padding-top:16px;">
            <p style="margin:0;font-size:12px;color:#9ca3af;">If the button doesn't work, copy and paste this link into your browser:</p>
            <p style="margin:6px 0 0;font-size:12px;word-break:break-all;"><a href="${url}" style="color:#2563eb;">${url}</a></p>
            <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;">If you didn't request this, you can safely ignore this email — your password won't change.</p>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Sends the password-reset link. If SMTP isn't configured, logs the link to the
 * server console instead (documented in the README) so dev still works.
 */
export async function sendPasswordResetEmail(to, resetUrl, companyName) {
  const conn = await getConnection();
  if (!conn) {
    console.log('\n🔗 Password reset link (SMTP not configured — logging instead of emailing):');
    console.log(`   To:   ${to}`);
    console.log(`   Link: ${resetUrl}\n`);
    return { delivered: false };
  }
  const company = companyName || conn.cfg.companyName || 'Office Management';
  await conn.transporter.sendMail({
    from: fromAddress(company, conn.cfg.user),
    to,
    subject: `Reset your ${company} password`,
    text: `Reset your ${company} password\n\nWe received a request to reset your password. Open the link below to choose a new one (it expires in about 30 minutes):\n\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`,
    html: resetEmailHtml(company, resetUrl),
  });
  return { delivered: true };
}

/**
 * Sends a test email to `to` using the current (DB or env) SMTP config — used by
 * the Settings "Send test email" button to confirm the credentials actually
 * work. Throws on SMTP/auth failure so the caller can surface the real reason.
 */
export async function sendTestEmail(to, companyName) {
  const conn = await getConnection();
  if (!conn) return { delivered: false, reason: 'not_configured' };
  const company = companyName || conn.cfg.companyName || 'Office Management';
  await conn.transporter.sendMail({
    from: fromAddress(company, conn.cfg.user),
    to,
    subject: `${company} — test email`,
    text: `This is a test email from ${company}. If you received it, your email settings are working.`,
    html:
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:15px;color:#1f2430;">` +
      `<p>This is a <strong>test email</strong> from ${company}.</p>` +
      `<p>If you received it, your email (SMTP) settings are working ✅</p></div>`,
  });
  return { delivered: true, to };
}
