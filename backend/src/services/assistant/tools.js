/**
 * Buddy ke tools — AI aur aapke data ke beech ki ikloati khidki.
 * (Plan: audits/15-ai-buddy-plan.md §4, §5)
 *
 * TEEN niyam jo kabhi nahi todne:
 *
 * 1. **AI ko database kabhi nahi milta.** Use sirf ye ginti ke tools milte hain. Koi
 *    khula sawaal, koi free query nahi.
 * 2. **Kaun poochh raha hai, ye TOKEN se aata hai.** Har `run(user, …)` ka `user` wahi
 *    hai jo `requireAuth` ne nikala. AI jo likhe, usse koi farak nahi padta — apne wale
 *    tools me `userId` ka parameter hi nahi hai.
 * 3. **Jo tool nahi milna chahiye, wo bheja hi nahi jata.** `toolsFor(user)` permission se
 *    chhaant deta hai, to employee ki request me leadership wala tool MAUJOOD hi nahi
 *    hota. Jo cheez hai hi nahi, use jailbreak nahi kiya ja sakta.
 *
 * Aur ek baat: **hisaab yahan nahi hota.** Har tool wahi service bulata hai jo page
 * bharti hai. Warna ek hi sawaal ke do jawab ho jate — page kuch aur, buddy kuch aur.
 */
import { can } from '../../lib/permissions.js';
import { ymdInTz } from '../../lib/time.js';
import { currentLeaveYear } from '../../lib/leaveYear.js';
import { User } from '../../models/User.js';
import { Setting } from '../../models/Setting.js';
import { listAttendance, attendanceOverview } from '../attendance.service.js';
import { listLeaves, balanceJSONReadOnly } from '../leave.service.js';
import { mySummary, leaderboard } from '../bonus.service.js';
import { listTasks } from '../task.service.js';
import { ledgerFor, personLedger } from '../dues.service.js';
import { getUserDossier } from '../dossier.service.js';
import { expenseSummary } from '../expense.service.js';
import { pendingFor } from '../approvals.service.js';
import { listHolidays } from '../holiday.service.js';
import { listVisible } from '../announcement.service.js';
import { leadersForPeriod, whosOut } from '../dashboard.service.js';
import { rulesForViewer } from '../../controllers/rules.controller.js';

/** Aaj (company time). Har tool ki default seema isi se banti hai. */
const today = () => ymdInTz(new Date());

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Date range ko kaabu me rakho.
 *
 * Do wajah: ek saal se badi range ka matlab hai sainkdon row Claude ko padhani padengi
 * (seedha paisa), aur aisa sawaal aam taur par galatfehmi hota hai, maang nahi.
 */
function range(input = {}, fallbackDays = 30) {
  const to = YMD.test(input.to || '') ? input.to : today();
  let from = YMD.test(input.from || '') ? input.from : '';
  if (!from) {
    const d = new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - fallbackDays);
    from = d.toISOString().slice(0, 10);
  }
  if (from > to) [from] = [to];
  // 400 din ki chhat — isse aage ka sawaal buddy se nahi, report se poochha jaata hai.
  const maxFrom = new Date(`${to}T00:00:00Z`);
  maxFrom.setUTCDate(maxFrom.getUTCDate() - 400);
  const floor = maxFrom.toISOString().slice(0, 10);
  return { from: from < floor ? floor : from, to, clipped: from < floor };
}

const hhmm = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : null);
const hours = (min) => Math.round(((min || 0) / 60) * 10) / 10;

/** Period (dashboard ke MonthPicker jaisa) → leadersForPeriod ke arguments. */
function leaderPeriod(input = {}) {
  if (input.period === 'all') return { scope: 'all' };
  if (/^\d{4}-\d{2}$/.test(input.month || '')) return { scope: 'month', month: input.month };
  return { scope: 'month', month: today().slice(0, 7) };
}

/**
 * Naam se aadmi pehchanna — SERVER karta hai, AI nahi.
 *
 * AI ko sirf wo naam milta hai jo user ne likha; kaunsa employee hai ye yahan tay hota
 * hai, roster se. Do log mil gaye to koi andaza NAHI — tool wapas poochhne ko kehta hai.
 * "Saini" do logon par fit baithta hai, aur galat aadmi ka data dikha dena usse kahin
 * bura hai jitna ek sawaal dobara poochhna.
 */
async function resolvePerson(name) {
  const q = String(name || '').trim().toLowerCase();
  if (q.length < 2) return { error: 'NEED_NAME', message: 'Which person? Please give a name.' };
  const people = await User.find({ isActive: true }).select('name employeeId role department');
  const words = q.split(/\s+/).filter(Boolean);
  const hits = people.filter((u) => {
    const n = u.name.toLowerCase();
    return n === q || words.every((w) => n.includes(w)) || u.employeeId?.toLowerCase() === q;
  });
  if (hits.length === 1) return { user: hits[0] };
  if (hits.length === 0) return { error: 'NO_SUCH_PERSON', message: `No active employee matches "${name}".` };
  return {
    error: 'AMBIGUOUS',
    message: `More than one person matches "${name}" — ask which one.`,
    candidates: hits.slice(0, 6).map((u) => u.name),
  };
}

/** Attendance ke record ko ginti me badalna — apne aur doosre, dono ke liye wahi. */
function summariseAttendance(records, total, from, to) {
  const days = { present: 0, late: 0, absent: 0, onLeave: 0, holiday: 0, wfh: 0 };
  let worked = 0;
  let overtime = 0;
  const lateDays = [];
  for (const r of records) {
    worked += r.workedMinutes || 0;
    overtime += r.overtimeMinutes || 0;
    if (r.status === 'PRESENT') days.present += 1;
    else if (r.status === 'LATE') {
      // Excused late = on duty (site visit etc.) — app isi tarah ginti hai.
      if (r.excused) days.present += 1;
      else { days.late += 1; lateDays.push({ date: ymdInTz(r.date), checkIn: hhmm(r.checkInAt) }); }
    } else if (r.status === 'ABSENT') days.absent += 1;
    else if (r.status === 'ON_LEAVE') days.onLeave += 1;
    else if (r.status === 'HOLIDAY') days.holiday += 1;
    else if (r.status === 'WFH') days.wfh += 1;
  }
  return {
    from, to, days,
    workedHours: hours(worked),
    overtimeHours: hours(overtime),
    lateDays: lateDays.slice(0, 10),
    ...(total > records.length ? { note: `Only the ${records.length} most recent days of ${total} are counted here — ask for a shorter range.` } : {}),
  };
}

const PERSON_RANGE_SCHEMA = {
  type: 'object',
  properties: {
    person: { type: 'string', description: "The employee's name as the user said it." },
    from: { type: 'string', description: 'Start date, YYYY-MM-DD. Defaults to 30 days back.' },
    to: { type: 'string', description: 'End date, YYYY-MM-DD. Defaults to today.' },
  },
  required: ['person'],
  additionalProperties: false,
};

const DATE_RANGE_SCHEMA = {
  type: 'object',
  properties: {
    from: { type: 'string', description: 'Start date, YYYY-MM-DD. Defaults to 30 days back.' },
    to: { type: 'string', description: 'End date, YYYY-MM-DD. Defaults to today.' },
  },
  additionalProperties: false,
};

const PERIOD_SCHEMA = {
  type: 'object',
  properties: {
    month: { type: 'string', description: 'A month as YYYY-MM. Defaults to the current month.' },
    period: { type: 'string', enum: ['month', 'all'], description: '"all" for all-time instead of a month.' },
  },
  additionalProperties: false,
};

/* ─────────────────────────── APNI CHEEZEIN — sabko ────────────────────────────
 * In sab me `userId` ka parameter JAAN-BUJH KAR nahi hai. Service khud token wale
 * user par gir jati hai (listAttendance ka "privacy default"), to AI chaahe bhi kisi
 * aur ka naam nahi daal sakta — daalne ki jagah hi nahi hai.
 */

const SELF_TOOLS = [
  {
    name: 'my_attendance',
    description:
      "The signed-in person's own attendance for a date range: how many days present / late / absent / on leave / work-from-home, total hours worked, total overtime, and the dates they were late. Use for questions like \"how many days was I late this month\" or \"my overtime in October\".",
    input_schema: DATE_RANGE_SCHEMA,
    run: async (user, input) => {
      const { from, to, clipped } = range(input);
      const { records, total } = await listAttendance(user, { from, to, limit: 100 });
      return {
        ...summariseAttendance(records, total, from, to),
        ...(clipped ? { note2: 'The range was clipped to the last 400 days.' } : {}),
      };
    },
  },
  {
    name: 'my_day',
    description:
      "One single day of the signed-in person's own attendance: check-in, check-out, hours worked, overtime, status, and the late reason if there was one. Use for \"what time did I check in on 15 January\".",
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'The day, YYYY-MM-DD.' } },
      required: ['date'],
      additionalProperties: false,
    },
    run: async (user, input) => {
      const date = YMD.test(input.date || '') ? input.date : today();
      const { records } = await listAttendance(user, { from: date, to: date, limit: 1 });
      const r = records[0];
      if (!r) return { date, found: false, note: 'No attendance record for that day.' };
      return {
        date, found: true,
        checkIn: hhmm(r.checkInAt),
        checkOut: hhmm(r.checkOutAt),
        workedHours: hours(r.workedMinutes),
        overtimeHours: hours(r.overtimeMinutes),
        status: r.status,
        excused: !!r.excused,
        halfDay: r.halfDayLeave ? (r.halfDayPart === 'SECOND' ? 'afternoon off' : 'morning off') : null,
        lateReason: r.lateReason?.category || null,
        viaSelfie: !!r.checkInMeta?.selfieKey,
      };
    },
  },
  {
    name: 'my_leave_balance',
    description:
      "The signed-in person's own leave balance for the current leave year (1 April – 31 March): total quota, days used, days left. Also their work-from-home allowance.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (user) => {
      const year = currentLeaveYear();
      const b = await balanceJSONReadOnly(user, year);
      return {
        leaveYear: `1 Apr ${year} – 31 Mar ${year + 1}`,
        totalQuota: b.totalQuota,
        used: b.used,
        remaining: b.remaining,
        wfhUsed: b.wfh?.used ?? null,
        wfhRemaining: b.wfh?.remaining ?? null,
        note: 'Unused leave does NOT carry over — it ends on 31 March.',
      };
    },
  },
  {
    name: 'my_leaves',
    description:
      "The signed-in person's own leave requests in a date range, with status (pending / approved / rejected) and how many days each one was.",
    input_schema: DATE_RANGE_SCHEMA,
    run: async (user, input) => {
      const { from, to } = range(input, 180);
      const rows = await listLeaves(user, { from, to });
      return {
        from, to, count: rows.length,
        leaves: rows.slice(0, 20).map((l) => ({
          type: l.type,
          from: l.startYMD,
          to: l.endYMD,
          days: l.workingDays,
          halfDay: l.halfDay ? (l.halfDayPart === 'SECOND' ? 'afternoon' : 'morning') : null,
          status: l.status,
          reason: l.reason || null,
        })),
      };
    },
  },
  {
    name: 'my_points',
    description:
      "The signed-in person's own reward points for a month: the total, what it is worth in rupees, and where the points came from or were lost.",
    input_schema: {
      type: 'object',
      properties: { month: { type: 'string', description: 'Month as YYYY-MM. Defaults to this month.' } },
      additionalProperties: false,
    },
    run: async (user, input) => {
      const s = await mySummary(user, { month: input.month });
      // Har entry nahi — wajah ke hisaab se joadi hui ginti. Wahi kaam ki baat hai,
      // aur 200 row Claude ko padhana bekaar ka kharcha hai.
      const bySource = {};
      for (const e of s.entries) {
        const k = e.reason || e.source || 'other';
        bySource[k] = (bySource[k] || 0) + (e.points || 0);
      }
      return {
        month: s.month,
        enabled: s.enabled,
        points: s.points,
        rupees: s.rupees,
        rupeesPerPoint: s.rupeesPerPoint,
        bySource: Object.entries(bySource)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, 12)
          .map(([reason, points]) => ({ reason, points })),
      };
    },
  },
  {
    name: 'my_tasks',
    description:
      "The signed-in person's own to-do items: what is pending and what is done, with due dates. Only their own work — never anybody else's.",
    input_schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['PENDING', 'DONE'], description: 'Filter by status. Omit for both.' } },
      additionalProperties: false,
    },
    run: async (user, input) => {
      const status = ['PENDING', 'DONE'].includes(input.status) ? input.status : undefined;
      const { tasks, total } = await listTasks(user, { scope: 'mine', status, limit: 20 });
      return {
        total,
        showing: tasks.length,
        tasks: tasks.map((t) => ({
          title: t.title,
          status: t.status,
          due: t.dueYMD || null,
          assignedBy: t.assignedBy?.name || null,
          overdue: !!t.dueYMD && t.status === 'PENDING' && t.dueYMD < today(),
        })),
      };
    },
  },
  {
    name: 'my_dues',
    description:
      "The signed-in person's own dues ledger: how much they owe right now, any advance they are holding, and the most recent entries. Never anybody else's dues.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (user) => {
      const l = await ledgerFor(user._id);
      return {
        pending: l.pending,
        advance: l.advance,
        recent: l.entries.slice(0, 10).map((e) => ({
          date: e.dateYMD || (e.date ? String(e.date).slice(0, 10) : null),
          kind: e.kind,
          item: e.item || null,
          amount: e.amount,
          status: e.status || null,
        })),
      };
    },
  },
];

/* ───────────────── SABKE DEKHNE KI CHEEZEIN — sabko ─────────────────
 * Ye wahi cheezein hain jo aaj bhi har bande ko app me dikhti hain. Buddy koi naya
 * darwaza nahi khol raha — sirf wahi dikha raha hai jo pehle se khula hai.
 */

const PUBLIC_TOOLS = [
  {
    name: 'holidays',
    description: 'Company holidays and birthdays in a date range. Everyone can see these — the calendar page shows the same list.',
    input_schema: DATE_RANGE_SCHEMA,
    run: async (_user, input) => {
      const { from, to } = range(input, 90);
      const rows = await listHolidays({ from, to });
      // Field ke naam Holiday model se hain: `title`, `startYMD`, `endYMD`. Pehle yahan
      // `name` aur `dateYMD` padhe ja rahe the — dono maujood hi nahi, to buddy ko
      // sirf `{type:'HOLIDAY'}` milta tha aur wo seedha keh deta tha ki "ginti to hai
      // par naam-tareekh nahi dikh rahe". Jawab galat nahi tha, data hi khaali tha.
      return {
        from, to,
        holidays: rows.slice(0, 40).map((h) => ({
          name: h.title,
          date: h.startYMD,
          ...(h.endYMD && h.endYMD !== h.startYMD ? { until: h.endYMD } : {}),
          type: h.type, // HOLIDAY ya BIRTHDAY
          ...(h.description ? { note: h.description } : {}),
        })),
      };
    },
  },
  {
    name: 'announcements',
    description: 'Recent announcements the signed-in person is allowed to see — the same ones the Announcements page shows them.',
    input_schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many, max 10. Default 5.' } },
      additionalProperties: false,
    },
    run: async (user, input) => {
      const limit = Math.min(Math.max(Number(input.limit) || 5, 1), 10);
      const rows = await listVisible(user);
      return {
        count: rows.length,
        announcements: rows.slice(0, limit).map((a) => ({
          title: a.title,
          body: String(a.body || '').slice(0, 400),
          important: !!a.important,
          by: a.createdBy?.name || null,
          at: a.publishAt || a.createdAt || null,
        })),
      };
    },
  },
  {
    name: 'task_leaders',
    description:
      'The public task leaderboard from the dashboard: who finished the most delegated work ON TIME where a CEO & President is involved. Everyone can see this. It does NOT count every task — only that kind.',
    input_schema: PERIOD_SCHEMA,
    run: async (_user, input) => {
      const p = await leadersForPeriod(leaderPeriod(input));
      return {
        period: p.label,
        counts: 'on-time delegated tasks where a CEO & President is involved',
        leaders: p.task.slice(0, 10).map((r) => ({ name: r.name, tasks: r.count })),
      };
    },
  },
  {
    name: 'overtime_leaders',
    description: 'The public overtime leaderboard from the dashboard: who put in the most overtime in a period. Everyone can see this.',
    input_schema: PERIOD_SCHEMA,
    run: async (_user, input) => {
      const p = await leadersForPeriod(leaderPeriod(input));
      return {
        period: p.label,
        leaders: p.overtime.slice(0, 10).map((r) => ({ name: r.name, overtimeHours: hours(r.overtimeMinutes) })),
      };
    },
  },
  {
    name: 'office_rules',
    description:
      'The office rule book — attendance timings, leave rules, points, conduct. Use this for "how does X work here" questions instead of answering from general knowledge.',
    input_schema: {
      type: 'object',
      properties: { topic: { type: 'string', description: 'A word to narrow it down, e.g. "leave", "late", "points". Omit for everything.' } },
      additionalProperties: false,
    },
    run: async (user, input) => {
      const { sections } = await rulesForViewer(user);
      const q = String(input.topic || '').trim().toLowerCase();
      const hit = (s) => !q || s.title?.toLowerCase().includes(q) || s.rules.some((r) => r.text.toLowerCase().includes(q));
      const picked = sections.filter(hit).slice(0, 4);
      return {
        topic: q || 'all',
        sections: picked.map((s) => ({ title: s.title, rules: s.rules.map((r) => r.text).slice(0, 12) })),
        ...(picked.length === 0 ? { note: 'Nothing in the rule book matches that word.' } : {}),
      };
    },
  },
];

/* ------------------ DOOSRON KI CHEEZEIN - sirf jinhe ijaazat hai ------------------
 * Har `gate` wahi permission hai jo AAJ us page/route par lagi hai. Yahan naya niyam
 * nahi banaya gaya - jo app me khula hai wahi, jo band hai wo band.
 */

const LEAD_TOOLS = [
  {
    name: 'user_attendance',
    gate: 'viewEveryone',
    description: "Another employee's attendance over a date range: days present / late / absent / on leave, hours worked, overtime, and the dates they were late.",
    input_schema: PERSON_RANGE_SCHEMA,
    run: async (user, input) => {
      const who = await resolvePerson(input.person);
      if (who.error) return who;
      const { from, to } = range(input);
      const { records, total } = await listAttendance(user, { userId: who.user._id, from, to, limit: 100 });
      return { person: who.user.name, ...summariseAttendance(records, total, from, to) };
    },
  },
  {
    name: 'user_leaves',
    // `approveLeave`, `viewEveryone` NAHI - kyunki listLeaves KHUD yahi dekhti hai
    // (leave.service.js). Agar yahan viewEveryone lagate to jis bande ke paas
    // viewEveryone hai par approveLeave nahi, usey service chupchaap USI KI APNI leaves
    // laut deti - galat jawab, mana karna nahi. Gate wahi rakha jo service maanti hai.
    gate: 'approveLeave',
    description: "Another employee's leave requests in a date range, with status and how many days each one was.",
    input_schema: PERSON_RANGE_SCHEMA,
    run: async (user, input) => {
      const who = await resolvePerson(input.person);
      if (who.error) return who;
      const { from, to } = range(input, 180);
      const rows = await listLeaves(user, { userId: who.user._id, from, to });
      return {
        person: who.user.name,
        from, to, count: rows.length,
        leaves: rows.slice(0, 20).map((l) => ({
          type: l.type, from: l.startYMD, to: l.endYMD, days: l.workingDays,
          halfDay: l.halfDay ? (l.halfDayPart === 'SECOND' ? 'afternoon' : 'morning') : null,
          status: l.status,
        })),
      };
    },
  },
  {
    name: 'user_tasks',
    gate: 'viewEveryone',
    description: "Another employee's own tasks - what is pending and what is done. The same list the Team page shows for that person.",
    input_schema: {
      type: 'object',
      properties: {
        person: { type: 'string', description: "The employee's name as the user said it." },
        status: { type: 'string', enum: ['PENDING', 'DONE'], description: 'Filter by status. Omit for both.' },
      },
      required: ['person'],
      additionalProperties: false,
    },
    run: async (_user, input) => {
      const who = await resolvePerson(input.person);
      if (who.error) return who;
      // Dossier hi wo jagah hai jahan app kisi AUR ke task dikhati hai (listTasks sirf
      // apne/assigned/tagged jaanta hai), aur uska route bhi `viewEveryone` par hai.
      const to = today();
      const from = `${to.slice(0, 4)}-01-01`;
      const d = await getUserDossier(who.user._id, { from, to });
      // Dossier `{ total, pending, done, overdue, items }` lautata hai. Pehle yahan
      // `d.tasks.tasks` padha ja raha tha — jo hai hi nahi — to HAR bande ke 0 task
      // dikhte the. Ye khaali jawab error se bura hai: dikhta sahi hai, hota galat.
      const t = d.tasks || {};
      let rows = Array.isArray(t.items) ? t.items : [];
      if (['PENDING', 'DONE'].includes(input.status)) rows = rows.filter((x) => x.status === input.status);
      return {
        person: who.user.name,
        since: from,
        total: t.total ?? rows.length,
        pending: t.pending ?? null,
        done: t.done ?? null,
        overdue: t.overdue ?? null,
        showing: Math.min(rows.length, 15),
        tasks: rows.slice(0, 15).map((x) => ({ title: x.title, status: x.status, due: x.dueYMD || null })),
      };
    },
  },
  {
    name: 'today_roster',
    gate: 'viewEveryone',
    description: 'The whole team for one day: how many are present, late, absent, on leave or working from home, and who is in which group. The same figures the Attendance Everyone tab shows.',
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'The day, YYYY-MM-DD. Defaults to today.' } },
      additionalProperties: false,
    },
    run: async (_user, input) => {
      const ymd = YMD.test(input.date || '') ? input.date : today();
      const o = await attendanceOverview(ymd);
      const names = (st) => o.rows.filter((r) => r.status === st).map((r) => r.user.name).slice(0, 15);
      return {
        date: o.date,
        summary: o.summary,
        late: o.rows
          .filter((r) => r.status === 'LATE' && !r.attendance?.excused)
          .map((r) => ({ name: r.user.name, checkIn: hhmm(r.attendance?.checkInAt) }))
          .slice(0, 15),
        absent: names('ABSENT'),
        onLeave: names('ON_LEAVE'),
        notInYet: names('AWAITED'),
      };
    },
  },
  {
    name: 'who_is_on_leave',
    gate: 'viewEveryone',
    description: 'Who is on leave or working from home today, and whose leave starts in the next week.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async () => {
      const settings = await Setting.getSingleton();
      const w = await whosOut(today(), settings);
      return {
        date: today(),
        onLeave: w.onLeave,
        workingFromHome: w.officeWfh ? 'the whole office today' : w.wfh,
        comingUp: w.upcoming,
      };
    },
  },
  {
    name: 'pending_approvals',
    gate: ['approveLeave', 'approveRegularization'],
    description: 'What is waiting on the signed-in person to approve: leave requests, attendance corrections and tasks to review.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
    run: async (user) => {
      const p = await pendingFor(user);
      return {
        counts: p.counts,
        leaves: p.leaves.slice(0, 10).map((l) => ({ person: l.user?.name, type: l.type, from: l.startYMD, to: l.endYMD, days: l.workingDays })),
        corrections: p.regularizations.slice(0, 10).map((r) => ({ person: r.user?.name, date: r.dateYMD, in: r.requestedCheckIn, out: r.requestedCheckOut })),
        tasks: p.tasks.slice(0, 10).map((t) => ({ title: t.title, person: t.owner?.name })),
      };
    },
  },
  {
    name: 'points_leaderboard',
    gate: 'manageSettings',
    description: "Everyone's reward points for a month, highest first. This is the points leaderboard - not the public task or overtime ones.",
    input_schema: {
      type: 'object',
      properties: { month: { type: 'string', description: 'Month as YYYY-MM. Defaults to this month.' } },
      additionalProperties: false,
    },
    run: async (_user, input) => {
      const rows = await leaderboard({ month: input.month });
      return {
        month: input.month || today().slice(0, 7),
        leaders: rows.slice(0, 15).map((r) => ({ name: r.user?.name ?? r.name, points: r.points })),
      };
    },
  },
  {
    name: 'expenses',
    gate: 'viewExpenses',
    description: 'Office expenses over a date range: the total, how many entries, and the biggest categories.',
    input_schema: DATE_RANGE_SCHEMA,
    run: async (_user, input) => {
      const { from, to } = range(input);
      const sum = await expenseSummary({ from, to });
      return { from, to, total: sum.total, entries: sum.count, topCategories: (sum.byCategory || []).slice(0, 6) };
    },
  },
  {
    name: 'user_dues',
    // Sirf `manageDues` - yaani Admin Manager. CEO ke paas bhi ye permission NAHI hai
    // (lib/permissions.js), to CEO ko bhi ye tool nahi milega. Owner ka niyam.
    gate: 'manageDues',
    description: "Another employee's dues ledger: what they owe, any advance, and the latest entries.",
    input_schema: {
      type: 'object',
      properties: { person: { type: 'string', description: "The employee's name as the user said it." } },
      required: ['person'],
      additionalProperties: false,
    },
    run: async (_user, input) => {
      const who = await resolvePerson(input.person);
      if (who.error) return who;
      const l = await personLedger(who.user._id);
      return {
        person: l.person.name,
        pending: l.pending,
        advance: l.advance,
        recent: l.entries.slice(0, 10).map((e) => ({
          date: e.dateYMD || (e.date ? String(e.date).slice(0, 10) : null),
          kind: e.kind, item: e.item || null, amount: e.amount, status: e.status || null,
        })),
      };
    },
  },
];

const ALL_TOOLS = [...SELF_TOOLS, ...PUBLIC_TOOLS, ...LEAD_TOOLS];

/**
 * Is bande ko kaunse tools milenge.
 *
 * Yahi wo jagah hai jahan security tay hoti hai. `gate` wale tool sirf tab bheje
 * jaate hain jab `can()` haan kahe — aur jo nahi bheja gaya, Claude use bula hi nahi
 * sakta, kyunki uski list me wo hai hi nahi.
 */
export function toolsFor(user) {
  // `gate` ek permission ho sakti hai ya kai - kai ka matlab "inme se koi ek kaafi hai"
  // (jaise approvals: leave approve karne wala bhi, correction approve karne wala bhi).
  return ALL_TOOLS.filter((t) => {
    if (!t.gate) return true;
    const needs = Array.isArray(t.gate) ? t.gate : [t.gate];
    return needs.some((perm) => can(user, perm));
  });
}

/** Claude ko bhejne wala roop — `run` kabhi bahar nahi jata. */
export const toolDefs = (tools) => tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

/**
 * Ek tool chalao.
 *
 * Dohri rok: `toolsFor` pehle hi chhaant chuka hai, aur yahan dobara usi list me
 * dhoondha jaata hai. Ek jagah galti ho to doosri pakad legi.
 */
export async function runTool(user, name, input) {
  const tool = toolsFor(user).find((t) => t.name === name);
  if (!tool) return { error: 'NOT_ALLOWED', message: 'You do not have access to that.' };
  try {
    return await tool.run(user, input || {});
  } catch (err) {
    // 403 ko wahi rehne do — Claude ko saaf pata chale ki mana hua hai, na ki "kuch toot gaya".
    if (err?.status === 403 || err?.code === 'FORBIDDEN') {
      return { error: 'NOT_ALLOWED', message: 'You do not have access to that.' };
    }
    console.error(`buddy tool ${name} failed:`, err?.message);
    return { error: 'FAILED', message: 'That could not be looked up right now.' };
  }
}
