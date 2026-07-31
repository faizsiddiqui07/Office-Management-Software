import { formatInTimeZone } from 'date-fns-tz';
import { Setting } from '../models/Setting.js';
import { User } from '../models/User.js';
import { notify } from '../models/Notification.js';
import { LEADERSHIP } from '../lib/permissions.js';
import { COMPANY_TZ, ymdInTz } from '../lib/time.js';
import { attendanceOverview } from './attendance.service.js';

/** "A, B, C +2 more" — keep a notification short when many names pile up. */
function names(list, n = 6) {
  if (list.length <= n) return list.join(', ');
  return `${list.slice(0, n).join(', ')} +${list.length - n} more`;
}

/**
 * Once a day, after the office-close time, push leadership ONE attendance round-up:
 * how many were in / WFH / on leave, who was absent with no leave, and who never checked
 * out. checkinAlert pings them on every check-in but nobody tells them about the day's
 * no-shows (the AWAITED→ABSENT flip happens silently when the work window closes) — this
 * is that one evening glance, deep-linked to the roster.
 *
 * Runs from the EventBridge schedule (see scheduler.service). Throttled AND claimed with
 * an atomic update, so ticks every few minutes across warm containers still send it once.
 * Best-effort: never throws.
 */
export async function maybeRunDayCloseDigest() {
  try {
    const settings = await Setting.getSingleton();
    const cfg = settings.eodDigest || {};
    if (cfg.enabled === false) return { skipped: 'disabled' };

    const todayYMD = ymdInTz(new Date());
    if (cfg.digestLastRun === todayYMD) return { skipped: 'already-sent' };
    if (formatInTimeZone(new Date(), COMPANY_TZ, 'HH:mm') < (cfg.time || '19:00')) return { skipped: 'too-early' };

    // Claim the day BEFORE sending — only the update that flips it wins, so two ticks (or
    // two containers) can't both fire the digest.
    const claimed = await Setting.findOneAndUpdate(
      { key: 'global', 'eodDigest.digestLastRun': { $ne: todayYMD } },
      { $set: { 'eodDigest.digestLastRun': todayYMD } },
    );
    Setting.invalidateCache();
    if (!claimed) return { skipped: 'raced' };

    const overview = await attendanceOverview(todayYMD);
    const s = overview.summary;
    // Nothing to report on a full day off — nobody was expected in (weekend/holiday).
    if (s.present + s.late + s.absent + (s.wfh || 0) === 0) return { skipped: 'non-working-day' };

    const absent = overview.rows.filter((r) => r.status === 'ABSENT').map((r) => r.user.name);
    const noCheckout = overview.rows
      .filter((r) => r.attendance?.checkInAt && !r.attendance?.checkOutAt)
      .map((r) => r.user.name);

    const head = [`${s.present + s.late}/${s.total} in`];
    if (s.wfh) head.push(`${s.wfh} WFH`);
    if (s.onLeave) head.push(`${s.onLeave} leave`);

    const lines = [];
    if (absent.length) lines.push(`Absent (no leave): ${names(absent)}`);
    if (noCheckout.length) lines.push(`No check-out: ${names(noCheckout)}`);

    const recipients = await User.find({ role: { $in: LEADERSHIP }, isActive: true }).select('_id');
    await Promise.all(
      recipients.map((u) =>
        notify({
          user: u._id,
          type: 'DAY_DIGEST',
          title: `Day close · ${head.join(' · ')}`,
          message: lines.length ? lines.join(' · ') : 'Everyone accounted for.',
          link: '/attendance?tab=everyone',
        }),
      ),
    );

    return { sent: recipients.length, absent: absent.length, noCheckout: noCheckout.length };
  } catch (err) {
    console.error('day-close digest failed:', err?.message);
    return { error: err?.message || 'error' };
  }
}
