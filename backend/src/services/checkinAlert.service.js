import { formatInTimeZone } from 'date-fns-tz';
import { Setting } from '../models/Setting.js';
import { User } from '../models/User.js';
import { notify } from '../models/Notification.js';
import { LEADERSHIP } from '../lib/permissions.js';
import { COMPANY_TZ } from '../lib/time.js';

/**
 * Fire-and-forget: notify leadership (CEO / Boss) in-app when an employee checks
 * in. Never throws — a failure here must never affect the check-in response.
 * Controlled by settings.checkinAlerts (enabled defaults on; onlyLate optional).
 */
export async function notifyCheckIn(actor, record) {
  try {
    const settings = await Setting.getSingleton();
    const cfg = settings.checkinAlerts || {};
    // Treat a missing flag as "on" so it works on existing installs.
    if (cfg.enabled === false) return;
    if (cfg.onlyLate === true && record.status !== 'LATE') return;

    const time = record.checkInAt
      ? formatInTimeZone(new Date(record.checkInAt), COMPANY_TZ, 'HH:mm')
      : '';
    const late = record.status === 'LATE';
    const title = `${actor.name} checked in${late ? ' (late)' : ''}`;
    const message = [actor.employeeId, time].filter(Boolean).join(' • ');
    const link = '/attendance?tab=everyone';

    const recipients = await User.find({
      role: { $in: LEADERSHIP },
      isActive: true,
      _id: { $ne: actor._id },
    }).select('_id');

    await Promise.all(
      recipients.map((u) =>
        notify({ user: u._id, type: late ? 'CHECK_IN_LATE' : 'CHECK_IN', title, message, link }),
      ),
    );
  } catch (err) {
    console.error('notifyCheckIn failed:', err?.message);
  }
}
