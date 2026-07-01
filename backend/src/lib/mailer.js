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

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Ready-made leave-request email to the approvers (CEO & President). `to` may be
 * a single address or an array. Falls back to console logging if SMTP is off.
 */
export async function sendLeaveRequestEmail(to, d) {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!recipients.length) return { delivered: false };

  const company = d.companyName || 'Office Management';
  const accent = /^#[0-9a-fA-F]{6}$/.test(d.brandColor || '') ? d.brandColor : '#4f46e5';
  const dates = d.startYMD === d.endYMD ? d.startYMD : `${d.startYMD} → ${d.endYMD}`;
  const dateLine = `${dates}${d.halfDay ? ' (half day)' : ''}`;
  const days = `${d.workingDays} day${Number(d.workingDays) === 1 ? '' : 's'}`;
  const subject = `New leave request — ${d.applicantName} (${days})`;

  const text =
    `${d.applicantName} has applied for ${String(d.type || '').toLowerCase()} leave.\n` +
    `Dates: ${dateLine}\nWorking days: ${d.workingDays}\nReason: ${d.reason || '—'}\n\n` +
    `Review it in ${company}: ${d.link}`;

  const row = (label, value) =>
    `<tr><td style="padding:7px 0;color:#6b7280;font-size:13px;">${esc(label)}</td>` +
    `<td style="padding:7px 0;text-align:right;font-weight:600;font-size:14px;color:#1f2430;">${esc(value)}</td></tr>`;

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#f4f5f7;padding:24px;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
      <div style="background:${accent};color:#ffffff;padding:20px 24px;">
        <div style="font-size:18px;font-weight:700;">${esc(company)}</div>
        <div style="font-size:13px;opacity:.9;margin-top:2px;">New leave request</div>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 16px;font-size:15px;color:#1f2430;"><strong>${esc(d.applicantName)}</strong> has applied for leave and needs your approval.</p>
        <table style="width:100%;border-collapse:collapse;border-top:1px solid #eef0f3;">
          ${row('Type', d.type)}
          ${row('Dates', dateLine)}
          ${row('Working days', d.workingDays)}
          ${row('Reason', d.reason || '—')}
        </table>
        <a href="${esc(d.link)}" style="display:inline-block;margin-top:22px;background:${accent};color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px;font-weight:600;">Review request →</a>
        <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">You’re receiving this because you approve leave for ${esc(company)}.</p>
      </div>
    </div>
  </div>`;

  const t = getTransporter();
  if (!t) {
    console.log('\n📧 Leave request email (SMTP not configured — logging instead):\n', text, '\n');
    return { delivered: false };
  }
  await t.sendMail({ from: fromAddress(company), to: recipients, subject, text, html });
  return { delivered: true };
}
