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
import { listAttendance } from '../attendance.service.js';
import { listLeaves, balanceJSONReadOnly } from '../leave.service.js';
import { mySummary } from '../bonus.service.js';
import { listTasks } from '../task.service.js';
import { ledgerFor } from '../dues.service.js';
import { listHolidays } from '../holiday.service.js';
import { listVisible } from '../announcement.service.js';
import { leadersForPeriod } from '../dashboard.service.js';
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
      return {
        from, to,
        holidays: rows.slice(0, 40).map((h) => ({ date: h.dateYMD || h.date, name: h.name, type: h.type, optional: !!h.optional })),
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

/** Phase 1 ka poora set. Phase 2 me leadership wale tools isi list me judenge. */
const ALL_TOOLS = [...SELF_TOOLS, ...PUBLIC_TOOLS];

/**
 * Is bande ko kaunse tools milenge.
 *
 * Yahi wo jagah hai jahan security tay hoti hai. `gate` wale tool sirf tab bheje
 * jaate hain jab `can()` haan kahe — aur jo nahi bheja gaya, Claude use bula hi nahi
 * sakta, kyunki uski list me wo hai hi nahi.
 */
export function toolsFor(user) {
  return ALL_TOOLS.filter((t) => !t.gate || can(user, t.gate));
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
