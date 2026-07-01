import nodemailer from 'nodemailer';

let transporter = null;

/**
 * The From address. Uses the authenticated SMTP account (e.g. the Gmail user) so
 * SPF/DKIM pass and the mail lands in the inbox — a fake domain like
 * no-reply@example.com gets flagged as spam or rewritten.
 */
function fromAddress(name) {
  const user = process.env.SMTP_USER;
  if (user) return `${name || 'Office Management'} <${user}>`;
  return process.env.SMTP_FROM || 'Office Management <no-reply@example.com>';
}

function getTransporter() {
  if (transporter) return transporter;
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT) || 587,
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
  return transporter;
}

/**
 * Sends the password-reset link. If SMTP isn't configured, logs the link to the
 * server console instead (documented in the README) so dev still works.
 */
export async function sendPasswordResetEmail(to, resetUrl) {
  const t = getTransporter();
  if (!t) {
    console.log('\n🔗 Password reset link (SMTP not configured — logging instead of emailing):');
    console.log(`   To:   ${to}`);
    console.log(`   Link: ${resetUrl}\n`);
    return { delivered: false };
  }
  await t.sendMail({
    from: fromAddress(),
    to,
    subject: 'Reset your Office Management password',
    text: `Reset your password using this link (valid ~30 minutes): ${resetUrl}`,
    html: `<p>Reset your password using this link (valid ~30 minutes):</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
  });
  return { delivered: true };
}
