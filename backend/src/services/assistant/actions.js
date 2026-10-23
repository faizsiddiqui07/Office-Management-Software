/**
 * Buddy ke KAAM — padhne wale tools se alag, aur jaan-bujh kar alag.
 * (Plan: audits/15-ai-buddy-plan.md, Phase 3)
 *
 * SABSE ZAROORI BAAT: in tools me se koi bhi kuch KARTA nahi hai.
 *
 * Har "propose_*" tool sirf itna karta hai — baat ko sulajhata hai, jaanchta hai, ek
 * line me likhta hai ki kya hoga, aur use TAJWEEZ bana kar rakh deta hai. Asli kaam
 * tabhi hota hai jab user `confirmAction()` tak pahunche, yaani Confirm daba de.
 *
 * Ye batwara is poore phase ki buniyaad hai. Padhne me galti ka matlab hai galat jawab;
 * likhne me galti ka matlab hai galat RECORD — jo kisi ki attendance, chhutti ya points
 * se juda hota hai. Isliye model ko likhne ka haq diya hi nahi gaya: wo sirf tajweez de
 * sakta hai, aur beech me ek insaan khada hai.
 *
 * Jo v1 me JAAN-BUJH KAR nahi hai: kisi AUR ko task dena, kisi ki chhutti approve karna,
 * attendance badalna, paise se juda kuch bhi. Pehla tabka galat ho to apna nuksaan; wo
 * wala galat ho to doosre ka record. Unke liye owner ka alag faisla chahiye.
 */
import { AssistantAction } from '../../models/AssistantAction.js';
import { Task } from '../../models/Task.js';
import { can } from '../../lib/permissions.js';
import { ymdInTz } from '../../lib/time.js';
import { createTask, setStatus } from '../task.service.js';
import { applyLeave } from '../leave.service.js';

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const today = () => ymdInTz(new Date());

function httpError(status, code, message) {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/** "2026-10-28" → "28 Oct 2026" — summary padhne layak rahe. */
const nice = (ymd) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * Har kaam ke do hisse: `propose` (sulajhao aur likho) aur `run` (karo).
 *
 * `propose` kabhi kuch nahi likhta — na task, na leave. Wo sirf itna tay karta hai ki
 * agar haan hui to EXACTLY kya hoga, aur wahi `payload` me jama kar deta hai.
 */
export const ACTIONS = {
  create_task: {
    gate: null, // to-do sabke paas hai
    label: 'Create a to-do',
    async propose(user, input) {
      const title = String(input.title || '').trim().slice(0, 200);
      if (title.length < 2) return { error: 'NEED_TITLE', message: 'What should the to-do say?' };
      const due = YMD.test(input.due || '') ? input.due : '';
      if (due && due < today()) {
        return { error: 'PAST_DATE', message: 'That due date is already past — pick today or later.' };
      }
      return {
        payload: { title, dueYMD: due },
        summary: `Create a to-do for yourself: “${title}”${due ? `, due ${nice(due)}` : ' (no due date)'}`,
      };
    },
    async run(user, payload) {
      // createTask `{ tasks: [...] }` lautata hai (ek hi banta hai — koi assignTo nahi).
      const { tasks } = await createTask(user, { title: payload.title, dueYMD: payload.dueYMD || '' });
      const t = tasks?.[0];
      return { created: t?.title ?? payload.title, id: String(t?.id ?? t?._id ?? '') };
    },
  },

  complete_task: {
    gate: null,
    label: 'Mark a to-do done',
    async propose(user, input) {
      const q = String(input.title || '').trim().toLowerCase();
      if (q.length < 2) return { error: 'NEED_TITLE', message: 'Which to-do? Give a few words from its title.' };
      // SIRF apne pending task — doosre ka task is raaste se chhua hi nahi ja sakta.
      const mine = await Task.find({ owner: user._id, status: 'PENDING' }).select('title dueYMD').limit(100);
      const hits = mine.filter((t) => t.title.toLowerCase().includes(q));
      if (hits.length === 0) return { error: 'NO_MATCH', message: `No pending to-do of yours matches “${input.title}”.` };
      if (hits.length > 1) {
        return {
          error: 'AMBIGUOUS',
          message: 'More than one of your to-dos matches — ask which one.',
          candidates: hits.slice(0, 6).map((t) => t.title),
        };
      }
      return {
        payload: { taskId: String(hits[0]._id), title: hits[0].title },
        summary: `Mark your to-do “${hits[0].title}” as done`,
      };
    },
    async run(user, payload) {
      // Service khud dobara dekhegi ki ye task isi ka hai (task.service ka apna guard).
      await setStatus(user, payload.taskId, 'DONE');
      return { completed: payload.title };
    },
  },

  apply_leave: {
    gate: 'applyLeave',
    label: 'Apply for leave',
    async propose(user, input) {
      const type = ['CASUAL', 'SICK'].includes(input.type) ? input.type : 'CASUAL';
      const from = YMD.test(input.from || '') ? input.from : '';
      if (!from) return { error: 'NEED_DATE', message: 'Which date is the leave for?' };
      const to = YMD.test(input.to || '') ? input.to : from;
      if (to < from) return { error: 'BAD_RANGE', message: 'The end date is before the start date.' };
      // Guzre hue din ki arzi yahan se nahi — wo leadership ka raasta hai.
      if (from < today()) return { error: 'PAST_DATE', message: 'That date is already past — leave for a past day has to go through leadership.' };
      const halfDay = !!input.halfDay && from === to;
      const part = input.halfDayPart === 'SECOND' ? 'SECOND' : 'FIRST';
      const reason = String(input.reason || '').trim().slice(0, 300);
      const span = from === to ? nice(from) : `${nice(from)} – ${nice(to)}`;
      const half = halfDay ? ` (half day — ${part === 'SECOND' ? 'afternoon' : 'morning'})` : '';
      return {
        payload: { type, startYMD: from, endYMD: to, halfDay, halfDayPart: halfDay ? part : null, reason },
        summary: `Apply for ${type.toLowerCase()} leave on ${span}${half}${reason ? ` — “${reason}”` : ''}. It will go to your approver.`,
      };
    },
    async run(user, payload) {
      const r = await applyLeave(user, {
        type: payload.type,
        startYMD: payload.startYMD,
        endYMD: payload.endYMD,
        halfDay: payload.halfDay,
        halfDayPart: payload.halfDayPart,
        reason: payload.reason,
      });
      return { applied: true, days: r?.workingDays ?? null, status: r?.status ?? 'PENDING' };
    },
  },
};

/** Jo kaam is bande ko diye ja sakte hain. */
export const actionsFor = (user) =>
  Object.entries(ACTIONS).filter(([, a]) => !a.gate || can(user, a.gate));

/** AI ko dikhne wale "propose" tools. */
export function actionTools(user) {
  const has = (k) => actionsFor(user).some(([key]) => key === k);
  const out = [];
  if (has('create_task')) {
    out.push({
      name: 'propose_create_task',
      description:
        'Prepare a new to-do for the signed-in person. This does NOT create it — it returns something for them to confirm. Only ever their own to-do, never anybody else’s.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'What the to-do says.' },
          due: { type: 'string', description: 'Due date YYYY-MM-DD. Omit if they did not give one.' },
        },
        required: ['title'],
        additionalProperties: false,
      },
    });
  }
  if (has('complete_task')) {
    out.push({
      name: 'propose_complete_task',
      description: 'Prepare to mark one of the signed-in person’s own pending to-dos as done. This does NOT change it — it returns something for them to confirm.',
      input_schema: {
        type: 'object',
        properties: { title: { type: 'string', description: 'A few words from the to-do’s title.' } },
        required: ['title'],
        additionalProperties: false,
      },
    });
  }
  if (has('apply_leave')) {
    out.push({
      name: 'propose_apply_leave',
      description:
        'Prepare a leave request for the signed-in person. This does NOT apply for it — it returns something for them to confirm, and it still has to be approved afterwards.',
      input_schema: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['CASUAL', 'SICK'], description: 'Defaults to casual.' },
          from: { type: 'string', description: 'First day, YYYY-MM-DD.' },
          to: { type: 'string', description: 'Last day, YYYY-MM-DD. Omit for a single day.' },
          halfDay: { type: 'boolean', description: 'True for half a day (single date only).' },
          halfDayPart: { type: 'string', enum: ['FIRST', 'SECOND'], description: 'FIRST = morning off, SECOND = afternoon off.' },
          reason: { type: 'string', description: 'Why, in their words. Optional.' },
        },
        required: ['from'],
        additionalProperties: false,
      },
    });
  }
  return out;
}

export const isActionTool = (name) => name.startsWith('propose_');

/**
 * Ek tajweez banao — aur SIRF tajweez.
 *
 * Model ko wapas jo jaata hai usme `id` aur `summary` hote hain, taaki wo user se saaf
 * shabdon me poochh sake. Kaam yahan bilkul nahi hota.
 */
export async function proposeAction(user, toolName, input) {
  const kind = toolName.replace(/^propose_/, '');
  const action = ACTIONS[kind];
  if (!action) return { error: 'UNKNOWN', message: 'That is not something I can do.' };
  if (action.gate && !can(user, action.gate)) {
    return { error: 'NOT_ALLOWED', message: 'You do not have access to that.' };
  }
  const made = await action.propose(user, input || {});
  if (made.error) return made;

  const doc = await AssistantAction.create({
    user: user._id,
    kind,
    payload: made.payload,
    summary: made.summary,
  });
  return {
    needsConfirm: true,
    proposalId: String(doc._id),
    summary: made.summary,
    note: 'Nothing has happened yet. Tell them what this will do and that they need to confirm it.',
  };
}

/**
 * Confirm — ab sach me kaam hota hai.
 *
 * Client se sirf `id` aata hai. Baaki sab yahan apni hi likhi hui tajweez se uthta hai,
 * aur permission DOBARA jaanchi jaati hai — tajweez banne aur Confirm dabne ke beech me
 * kisi ka role badla ho sakta hai.
 */
export async function confirmAction(user, proposalId) {
  const doc = await AssistantAction.findById(proposalId).catch(() => null);
  // "Mila hi nahi" aur "kisi aur ka hai" — dono ka ek hi jawab, taaki kisi doosre ki
  // tajweez ke hone-na-hone ka pata bhi na chale.
  if (!doc || String(doc.user) !== String(user._id)) {
    throw httpError(404, 'NOT_FOUND', 'That request has expired. Please ask again.');
  }
  if (doc.status !== 'PENDING') {
    throw httpError(409, 'ALREADY_DONE', 'That one has already been dealt with.');
  }
  const action = ACTIONS[doc.kind];
  if (!action) throw httpError(400, 'UNKNOWN', 'That is not something I can do.');
  if (action.gate && !can(user, action.gate)) {
    throw httpError(403, 'FORBIDDEN', 'You do not have access to that.');
  }

  // Pehle nishaan lagao, phir karo. Do baar Confirm dabne par doosri baar yahin ruk
  // jaata hai — warna ek hi "haan" par do leave lag sakti thi.
  const claimed = await AssistantAction.findOneAndUpdate(
    { _id: doc._id, status: 'PENDING' },
    { $set: { status: 'DONE', doneAt: new Date() } },
    { new: true },
  );
  if (!claimed) throw httpError(409, 'ALREADY_DONE', 'That one has already been dealt with.');

  try {
    const result = await action.run(user, doc.payload);
    return { kind: doc.kind, summary: doc.summary, result };
  } catch (err) {
    // Kaam nahi hua to tajweez wapas khuli chhod do — warna banda phansa reh jaata
    // hai: dobara Confirm bhi nahi kar sakta aur hua bhi kuch nahi.
    await AssistantAction.updateOne({ _id: doc._id }, { $set: { status: 'PENDING', doneAt: null } });
    throw err;
  }
}
