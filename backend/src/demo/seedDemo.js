/**
 * DEMO seed — fills a THROWAWAY `office_demo` database with a full, plausible office so the
 * app looks alive when shown to someone. Runs two ways:
 *   • locally:  MONGODB_DB=office_demo node scripts/seed-demo.js
 *   • nightly:  the demo Lambda's EventBridge {"job":"demo-reset"} → seedDemo({reset:true})
 *
 * NEVER point this at the real database — with reset:true it DROPS the database first.
 * `scripts/seed-demo.js` refuses to run unless MONGODB_DB contains "demo".
 */
import mongoose from 'mongoose';
import { hashPassword } from '../lib/password.js';
import { ensureSystemRoles, loadRoles } from '../lib/roles.js';
import { companyDayFromYMD, companyDayInstantAt, ymdInTz } from '../lib/time.js';
import { leaveYearOf } from '../lib/leaveYear.js';
import { User } from '../models/User.js';
import { Setting } from '../models/Setting.js';
import { LeaveBalance } from '../models/LeaveBalance.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Attendance } from '../models/Attendance.js';
import { Task } from '../models/Task.js';
import { Expense } from '../models/Expense.js';
import { LedgerEntry } from '../models/LedgerEntry.js';
import { Visitor } from '../models/Visitor.js';
import { PointEntry } from '../models/PointEntry.js';
import { Announcement } from '../models/Announcement.js';

export const DEMO_PASSWORD = 'Demo@123';

// One login per role is documented in the credentials list; the rest fill the org out.
// A part-timer (Divya) showcases the custom-schedule features.
export const DEMO_USERS = [
  { name: 'Aarav Sharma', email: 'ceo@demo.com', role: 'CEO', employeeId: 'DEMO-001', department: 'Leadership', designation: 'Chief Executive Officer' },
  { name: 'Vikram Nair', email: 'director@demo.com', role: 'DIRECTOR', employeeId: 'DEMO-002', department: 'Leadership', designation: 'Director' },
  { name: 'Priya Menon', email: 'admin@demo.com', role: 'ADMIN_MANAGER', employeeId: 'DEMO-003', department: 'Operations', designation: 'Admin Manager' },
  { name: 'Rohan Gupta', email: 'manager@demo.com', role: 'MANAGER', employeeId: 'DEMO-004', department: 'Engineering', designation: 'Engineering Manager' },
  { name: 'Sneha Reddy', email: 'manager2@demo.com', role: 'MANAGER', employeeId: 'DEMO-005', department: 'Sales', designation: 'Sales Manager' },
  { name: 'Imran Sheikh', email: 'employee@demo.com', role: 'EMPLOYEE', employeeId: 'DEMO-006', department: 'Engineering', designation: 'Software Engineer' },
  { name: 'Neha Gupta', email: 'neha@demo.com', role: 'EMPLOYEE', employeeId: 'DEMO-007', department: 'Design', designation: 'Product Designer' },
  { name: 'Arjun Mehta', email: 'arjun@demo.com', role: 'EMPLOYEE', employeeId: 'DEMO-008', department: 'Engineering', designation: 'Backend Engineer' },
  { name: 'Pooja Verma', email: 'pooja@demo.com', role: 'EMPLOYEE', employeeId: 'DEMO-009', department: 'Finance', designation: 'Accounts Executive' },
  { name: 'Karan Malhotra', email: 'karan@demo.com', role: 'EMPLOYEE', employeeId: 'DEMO-010', department: 'Sales', designation: 'Sales Executive' },
  { name: 'Divya Iyer', email: 'divya@demo.com', role: 'EMPLOYEE', employeeId: 'DEMO-011', department: 'Support', designation: 'Support Specialist', employmentType: 'PART_TIME', schedule: { workDays: [1, 3, 5], workStart: '10:00', workEnd: '15:00', graceMinutes: 10 } },
  { name: 'Rahul Desai', email: 'rahul@demo.com', role: 'EMPLOYEE', employeeId: 'DEMO-012', department: 'Engineering', designation: 'Frontend Engineer' },
  { name: 'Ananya Rao', email: 'ananya@demo.com', role: 'EMPLOYEE', employeeId: 'DEMO-013', department: 'Marketing', designation: 'Marketing Associate' },
  { name: 'Sameer Khan', email: 'sameer@demo.com', role: 'EMPLOYEE', employeeId: 'DEMO-014', department: 'Engineering', designation: 'QA Engineer' },
  { name: 'Meera Joshi', email: 'meera@demo.com', role: 'EMPLOYEE', employeeId: 'DEMO-015', department: 'HR', designation: 'HR Executive' },
  { name: 'Ramesh Yadav', email: 'officeboy@demo.com', role: 'OFFICE_BOY', employeeId: 'DEMO-016', department: 'Facilities', designation: 'Office Assistant' },
  { name: 'Suresh Singh', email: 'security@demo.com', role: 'SECURITY', employeeId: 'DEMO-017', department: 'Security', designation: 'Security Guard' },
];

const DEMO_FLOOR_YMD = '2026-04-01'; // matches the demo APP_LIVE_YMD env

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;
const pad = (n) => String(n).padStart(2, '0');
const addDaysYMD = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const minusMonthsYMD = (ymd, m) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString().slice(0, 10); };
const dow = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const monthOf = (ymd) => ymd.slice(0, 7);
function* eachDay(fromYMD, toYMD) { for (let d = fromYMD; d <= toYMD; d = addDaysYMD(d, 1)) yield d; }

export async function seedDemo({ reset = false } = {}) {
  if (reset) await mongoose.connection.dropDatabase();
  await ensureSystemRoles();
  await loadRoles();

  const today = ymdInTz(new Date());
  const start = (() => { const s = minusMonthsYMD(today, 4); return s < DEMO_FLOOR_YMD ? DEMO_FLOOR_YMD : s; })();
  const leaveYear = leaveYearOf(today);

  // ── Settings ──────────────────────────────────────────────
  const s = await Setting.getSingleton();
  s.companyName = 'BrainQbit';
  s.currency = 'INR';
  s.timezone = 'Asia/Kolkata';
  s.weekendDays = [0]; // Sunday off, Mon–Sat working
  s.workStart = '09:30';
  s.workEnd = '18:30';
  s.graceMinutes = 10;
  s.annualLeaveQuota = 18;
  s.bonus = {
    ...(s.bonus?.toObject ? s.bonus.toObject() : s.bonus),
    enabled: true,
    rupeesPerPoint: 10,
    graceDays: 1,
    autoRules: [
      { key: 'assignedTaskOnTime', points: 10 },
      { key: 'assignedTaskLate', points: 5 },
      { key: 'assignedTaskOverdueDaily', points: 2 },
      { key: 'forwardOnTime', points: 6 },
      { key: 'forwardLate', points: 3 },
      { key: 'punctualStreak', points: 8 },
      { key: 'lateArrival', points: 2 },
      { key: 'overtimeHour', points: 2 },
      { key: 'absentDay', points: 10 },
      { key: 'noLeaveMonth', points: 5 },
      { key: 'perfectAttendanceMonth', points: 10 },
    ],
  };
  s.markModified('bonus');
  await s.save();

  // ── Users + leave balances ────────────────────────────────
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const users = [];
  for (const u of DEMO_USERS) {
    const joined = companyDayFromYMD(u.joinedYMD || start);
    const doc = await User.create({
      name: u.name, email: u.email, employeeId: u.employeeId, passwordHash,
      role: u.role, department: u.department, designation: u.designation,
      employmentType: u.employmentType || 'FULL_TIME',
      schedule: u.schedule || {},
      dateOfJoining: joined, mustChangePassword: false, isActive: true,
    });
    users.push(doc);
    await LeaveBalance.create({ user: doc._id, year: leaveYear, totalQuota: 18, used: 0, remaining: 18, overtimeMinutes: 0 });
  }
  const byRole = (r) => users.filter((u) => u.role === r);
  const ceo = byRole('CEO')[0];
  const managers = [...byRole('MANAGER'), ...byRole('ADMIN_MANAGER'), ...byRole('DIRECTOR')];
  const assigners = [ceo, ...managers].filter(Boolean);
  // Reporting lines: non-leadership → a manager.
  const mgr = byRole('MANAGER')[0];
  if (mgr) await User.updateMany({ role: { $in: ['EMPLOYEE', 'OFFICE_BOY', 'SECURITY'] } }, { $set: { reportsTo: mgr._id } });

  // Attendance is only for self-tracking roles (leadership doesn't clock in).
  const tracked = users.filter((u) => !['CEO', 'DIRECTOR'].includes(u.role));
  const isWorkDay = (u, ymd) => {
    const wd = u.schedule?.workDays;
    if (Array.isArray(wd) && wd.length) return wd.includes(dow(ymd));
    return dow(ymd) !== 0; // office weekend = Sunday
  };

  // ── Leaves (approved + a couple pending) ──────────────────
  const onLeave = new Set(); // `${uid}|${ymd}` → this person is on approved leave that day
  const leaveDocs = [];
  const leaveTypes = ['CASUAL', 'SICK', 'PAID'];
  for (const u of tracked) {
    const spells = rand(1, 3);
    for (let i = 0; i < spells; i += 1) {
      const from = addDaysYMD(start, rand(5, Math.max(6, daysBetween(start, today) - 5)));
      const len = rand(1, 3);
      const to = addDaysYMD(from, len - 1);
      if (to >= today) continue; // keep approved leaves in the past
      const type = pick(leaveTypes);
      const wdays = countWorkDays(u, from, to, isWorkDay);
      if (wdays <= 0) continue;
      for (const d of eachDay(from, to)) if (isWorkDay(u, d)) onLeave.add(`${u._id}|${d}`);
      leaveDocs.push({
        user: u._id, type, status: 'APPROVED',
        startDate: companyDayFromYMD(from), endDate: companyDayFromYMD(to), startYMD: from, endYMD: to,
        workingDays: wdays, reason: pick(['Family function', 'Medical', 'Personal work', 'Out of town', 'Not well']),
        appliedAt: companyDayFromYMD(addDaysYMD(from, -3)), decidedBy: (mgr || ceo)?._id, decidedAt: companyDayFromYMD(addDaysYMD(from, -2)),
      });
    }
    // One upcoming pending request for some, so the approvals queue looks alive.
    if (chance(0.4)) {
      const from = addDaysYMD(today, rand(2, 20));
      leaveDocs.push({ user: u._id, type: pick(leaveTypes), status: 'PENDING', startDate: companyDayFromYMD(from), endDate: companyDayFromYMD(from), startYMD: from, endYMD: from, workingDays: 1, reason: 'Personal work', appliedAt: new Date() });
    }
  }
  if (leaveDocs.length) await LeaveRequest.insertMany(leaveDocs);

  // ── Attendance, day by day ────────────────────────────────
  const attDocs = [];
  for (const u of tracked) {
    const from = ymdInTz(u.dateOfJoining) > start ? ymdInTz(u.dateOfJoining) : start;
    for (const ymd of eachDay(from, today)) {
      if (!isWorkDay(u, ymd)) continue;
      const dayInstant = companyDayFromYMD(ymd);
      if (onLeave.has(`${u._id}|${ymd}`)) { attDocs.push({ user: u._id, date: dayInstant, status: 'ON_LEAVE' }); continue; }
      const roll = Math.random();
      // ~78% present, ~8% late, ~6% wfh, ~4% absent, rest present
      if (roll < 0.04) { attDocs.push({ user: u._id, date: dayInstant, status: 'ABSENT' }); continue; }
      if (roll < 0.10) { attDocs.push({ user: u._id, date: dayInstant, status: 'WFH', workedMinutes: rand(420, 510) }); continue; }
      const late = roll < 0.18;
      const inHM = late ? `${pad(rand(9, 10))}:${pad(rand(46, 59))}` : `09:${pad(rand(15, 40))}`;
      const outH = rand(18, 20);
      const outHM = `${pad(outH)}:${pad(rand(0, 59))}`;
      const checkInAt = companyDayInstantAt(dayInstant, inHM);
      const checkOutAt = companyDayInstantAt(dayInstant, outHM);
      const worked = Math.max(0, Math.round((checkOutAt - checkInAt) / 60000) - rand(30, 60)); // minus a lunch break
      const overtime = outH >= 19 ? rand(30, 120) : 0;
      // Today: leave a few still "in office" (no checkout) and a few not-yet-arrived.
      const openToday = ymd === today && chance(0.4);
      attDocs.push({
        user: u._id, date: dayInstant, status: late ? 'LATE' : 'PRESENT',
        checkInAt, checkOutAt: openToday ? null : checkOutAt,
        workedMinutes: openToday ? 0 : worked, overtimeMinutes: openToday ? 0 : overtime,
      });
    }
  }
  if (attDocs.length) await Attendance.insertMany(attDocs);

  // ── Tasks (assigned by leadership/managers to the team) ───
  const taskTitles = ['Prepare Q report', 'Fix login bug', 'Update client deck', 'Review pull request', 'Plan sprint', 'Call vendor', 'Design new landing page', 'Reconcile invoices', 'Onboard new hire', 'Write test cases', 'Deploy release', 'Follow up with lead', 'Refactor dashboard', 'Audit expenses', 'Draft policy doc'];
  const doers = users.filter((u) => ['EMPLOYEE', 'MANAGER'].includes(u.role));
  const taskDocs = [];
  for (let i = 0; i < 60; i += 1) {
    const owner = pick(doers);
    const assignedBy = pick(assigners);
    if (String(owner._id) === String(assignedBy._id)) continue;
    const dueYMD = addDaysYMD(start, rand(3, daysBetween(start, today) + 15));
    const past = dueYMD < today;
    let status = 'PENDING'; let completedAt = null; let completedBy = null;
    if (past) {
      if (chance(0.75)) { status = 'DONE'; completedBy = owner._id; completedAt = companyDayInstantAt(companyDayFromYMD(chance(0.8) ? dueYMD : addDaysYMD(dueYMD, rand(1, 4))), '17:30'); }
      // else: overdue (still pending, due in the past)
    } else if (chance(0.3)) {
      status = 'DONE'; completedBy = owner._id; completedAt = companyDayInstantAt(companyDayFromYMD(addDaysYMD(today, -rand(0, 3))), '16:00');
    }
    taskDocs.push({ title: pick(taskTitles), owner: owner._id, assignedBy: assignedBy._id, status, dueYMD, completedAt, completedBy, requiresApproval: chance(0.25), notes: chance(0.5) ? 'Please prioritise this.' : '' });
  }
  // A few personal to-dos (no assigner) too.
  for (let i = 0; i < 10; i += 1) { const owner = pick(doers); taskDocs.push({ title: pick(['Reply to emails', 'Book meeting room', 'Update timesheet', 'Read docs']), owner: owner._id, status: chance(0.5) ? 'DONE' : 'PENDING', completedAt: chance(0.5) ? new Date() : null, dueYMD: addDaysYMD(today, rand(-2, 5)) }); }
  const createdTasks = await Task.insertMany(taskDocs);

  // ── Expenses ──────────────────────────────────────────────
  const expCats = ['OFFICE_SUPPLIES', 'TRAVEL', 'FOOD', 'UTILITIES', 'RENT', 'SOFTWARE', 'MAINTENANCE', 'MISC'];
  const expTitles = { OFFICE_SUPPLIES: 'Stationery', TRAVEL: 'Cab fare', FOOD: 'Team lunch', UTILITIES: 'Electricity bill', RENT: 'Office rent', SOFTWARE: 'SaaS subscription', MAINTENANCE: 'AC servicing', MISC: 'Misc purchase' };
  const admin = byRole('ADMIN_MANAGER')[0] || ceo;
  const expDocs = [];
  for (let i = 0; i < 70; i += 1) {
    const ymd = addDaysYMD(start, rand(0, daysBetween(start, today)));
    const cat = pick(expCats);
    const rupees = cat === 'RENT' ? rand(25000, 45000) : cat === 'SOFTWARE' ? rand(1000, 8000) : rand(200, 6000);
    expDocs.push({ title: expTitles[cat], amount: rupees * 100, currency: 'INR', category: cat, date: companyDayFromYMD(ymd), dateYMD: ymd, paymentMethod: pick(['CASH', 'CARD', 'UPI', 'BANK_TRANSFER']), vendor: pick(['Amazon', 'Local store', 'Uber', 'Reliance', 'Zomato', 'AWS']), addedBy: admin._id });
  }
  await Expense.insertMany(expDocs);

  // ── Dues (a few people owe the admin; some payments) ──────
  const dueDocs = [];
  for (const u of tracked.slice(0, 8)) {
    const n = rand(1, 4);
    for (let i = 0; i < n; i += 1) {
      const ymd = addDaysYMD(start, rand(0, daysBetween(start, today)));
      dueDocs.push({ person: u._id, createdBy: admin._id, kind: 'DUE', amount: rand(50, 500) * 100, item: pick(['Lunch', 'Snacks', 'Stationery', 'Tea/Coffee']), source: pick(['Canteen', 'Store']), date: companyDayFromYMD(ymd), dateYMD: ymd });
    }
    if (chance(0.5)) { const ymd = addDaysYMD(today, -rand(1, 10)); dueDocs.push({ person: u._id, createdBy: admin._id, kind: 'PAYMENT', amount: rand(100, 400) * 100, date: companyDayFromYMD(ymd), dateYMD: ymd, note: 'Paid in cash' }); }
  }
  if (dueDocs.length) await LedgerEntry.insertMany(dueDocs);

  // ── Visitors (recent weeks + a couple expected) ───────────
  const visDocs = [];
  const hosts = users.filter((u) => ['MANAGER', 'ADMIN_MANAGER', 'EMPLOYEE'].includes(u.role));
  for (let i = 0; i < 30; i += 1) {
    const ymd = addDaysYMD(today, -rand(0, 40));
    const host = pick(hosts);
    const inH = rand(10, 16);
    const out = chance(0.85) || ymd < today;
    visDocs.push({ name: pick(['Rakesh Jain', 'Sunita Rao', 'Amit Bose', 'Kavya Nair', 'Deepak Shah', 'Farhan Ali', 'Nisha Kapoor']), phone: `9${rand(100000000, 999999999)}`, category: pick(['Visitors', 'Finance']), fromPlace: pick(['Delhi', 'Mumbai', 'Pune', 'Bangalore']), company: pick(['ABC Corp', 'XYZ Ltd', 'Client', 'Vendor Co']), toMeet: host.name, toMeetUser: host._id, purpose: pick(['Meeting', 'Delivery', 'Interview', 'Audit']), dateYMD: ymd, date: companyDayFromYMD(ymd), status: 'ARRIVED', checkInTime: `${pad(inH)}:${pad(rand(0, 59))}`, checkOutTime: out ? `${pad(inH + 1)}:${pad(rand(0, 59))}` : '', createdBy: admin._id });
  }
  // Pre-registered (expected) upcoming.
  for (let i = 0; i < 3; i += 1) { const ymd = addDaysYMD(today, rand(1, 7)); const host = pick(hosts); visDocs.push({ name: pick(['Manish Tiwari', 'Rekha Sharma', 'Gaurav Sethi']), category: 'Visitors', company: 'Prospect', toMeet: host.name, toMeetUser: host._id, purpose: 'Meeting', dateYMD: ymd, scheduledFor: ymd, date: companyDayFromYMD(ymd), status: 'EXPECTED', checkInTime: '', checkOutTime: '', createdBy: admin._id }); }
  await Visitor.insertMany(visDocs);

  // ── Points (a plausible ledger so Rewards/leaderboard look alive) ──
  const ptDocs = [];
  const months = [...new Set([...eachDay(start, today)].map(monthOf))];
  for (const u of tracked) {
    for (const m of months) {
      const earned = `${m}-15`;
      if (chance(0.8)) ptDocs.push({ user: u._id, month: m, earnedYMD: earned, points: rand(2, 5) * 10, reason: 'Assigned tasks done on time', source: 'auto_task', dedupeKey: `demo:auto_task:${u._id}:${m}` });
      if (chance(0.5)) ptDocs.push({ user: u._id, month: m, earnedYMD: earned, points: rand(2, 8), reason: 'Overtime', source: 'auto_ot', dedupeKey: `demo:auto_ot:${u._id}:${m}` });
      if (chance(0.4)) ptDocs.push({ user: u._id, month: m, earnedYMD: earned, points: -rand(2, 6), reason: 'Late arrivals', source: 'auto_late', dedupeKey: `demo:auto_late:${u._id}:${m}` });
      if (chance(0.3)) ptDocs.push({ user: u._id, month: m, earnedYMD: `${m}-06`, points: 8, reason: 'Punctual streak', source: 'auto_streak', dedupeKey: `demo:auto_streak:${u._id}:${m}` });
      if (chance(0.3)) ptDocs.push({ user: u._id, month: m, earnedYMD: `${m}-28`, points: 5, reason: 'No leave all month', source: 'auto_noleave', dedupeKey: `demo:auto_noleave:${u._id}:${m}` });
    }
  }
  if (ptDocs.length) await PointEntry.insertMany(ptDocs);

  // ── Announcements ─────────────────────────────────────────
  await Announcement.insertMany([
    { title: 'Welcome to the new office portal', body: 'Please update your profile and check your attendance daily.', priority: 'IMPORTANT', createdBy: ceo._id, audienceRoles: [], isActive: true, notifiedAt: new Date() },
    { title: 'Diwali holiday schedule', body: 'The office will remain closed on the announced dates. Plan your work accordingly.', priority: 'NORMAL', createdBy: (mgr || ceo)._id, audienceRoles: [], isActive: true, notifiedAt: new Date() },
    { title: 'Quarterly town hall on Friday', body: 'Join the all-hands at 4 PM in the main conference room.', priority: 'NORMAL', createdBy: ceo._id, audienceRoles: [], isActive: true, notifiedAt: new Date() },
  ]);

  return { users: users.length, attendance: attDocs.length, leaves: leaveDocs.length, tasks: createdTasks.length, expenses: expDocs.length, dues: dueDocs.length, visitors: visDocs.length, points: ptDocs.length, from: start, to: today };
}

function daysBetween(a, b) { return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000); }
function countWorkDays(u, from, to, isWorkDay) { let n = 0; for (let d = from; d <= to; d = addDaysYMD(d, 1)) if (isWorkDay(u, d)) n += 1; return n; }
