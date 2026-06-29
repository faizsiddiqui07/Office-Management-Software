import { User } from '../models/User.js';

/**
 * Generates the next unique employeeId in the form EMP-0007.
 * Zero-padded so lexical sort == numeric sort.
 */
export async function generateEmployeeId() {
  const last = await User.findOne({ employeeId: /^EMP-\d+$/ })
    .sort({ employeeId: -1 })
    .select('employeeId')
    .lean();

  let next = 1;
  if (last?.employeeId) {
    const n = parseInt(last.employeeId.replace('EMP-', ''), 10);
    if (!Number.isNaN(n)) next = n + 1;
  }

  for (let i = 0; i < 10000; i += 1) {
    const candidate = `EMP-${String(next).padStart(4, '0')}`;
    // eslint-disable-next-line no-await-in-loop
    const exists = await User.exists({ employeeId: candidate });
    if (!exists) return candidate;
    next += 1;
  }
  throw new Error('Could not generate a unique employeeId');
}
