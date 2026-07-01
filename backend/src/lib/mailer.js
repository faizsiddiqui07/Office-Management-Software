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
    text: `Reset your password using this link (valid ~30 minutes): ${resetUrl}`,
    html: `<p>Reset your password using this link (valid ~30 minutes):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
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
