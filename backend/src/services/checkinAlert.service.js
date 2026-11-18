import { formatInTimeZone } from 'date-fns-tz';
import { Setting } from '../models/Setting.js';
import { User } from '../models/User.js';
import { notify } from '../models/Notification.js';
import { LEADERSHIP } from '../lib/permissions.js';
import { COMPANY_TZ } from '../lib/time.js';

/**
 * Meant to notify leadership (CEO / Boss) when an employee checks in — bell row + phone
 * push. In THIS office it reaches nobody (see the ⚠ note at the recipient query below).
 * Never throws — a failure here must never affect the check-in response.
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

    // ⚠ REACHES NOBODY HERE — BY ACCIDENT, NOT BY A SWITCH. LEADERSHIP is ['CEO','DIRECTOR'],
    // seed roles this office no longer has (removed by hand before go-live; its owner role
    // is CEO_PRESIDENT), so since go-live (1 Jul 2026) this has found nobody. Found 18 Nov
    // 2026; the owner chose to leave it as it is rather than get ~8 phone pings a morning.
    // Do NOT "fix" the list without asking them.
    //
    // It is only off because no role has those KEYS. A role created on the Roles page with
    // the label "CEO" or "Director" gets exactly that key (roles.controller slugifies the
    // label) — and from the next check-in its holders, however junior, get every ping. To
    // make it really off, untick Settings → "Enable check-in alerts".
    //
    // If the owner ever wants it on, two things change together: recipients →
    // ownerRoleKeys() (lib/roles.js), AND attendance.controller.js must AWAIT notifyCheckIn —
    // Lambda freezes a floating promise, so the ping would arrive late or never (same
    // failure as the push fix in models/Notification.js).
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
