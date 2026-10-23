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
 * Jo ab bhi JAAN-BUJH KAR nahi hai: kisi ki chhutti approve karna, attendance badalna,
 * paise se juda kuch bhi. Un sab ke liye owner ka alag faisla chahiye.
 *
 * "Kisi aur ko task dena" owner ki ijaazat se juda (24 Oct 2026). Wo doosre ke account
 * par record banata hai, isliye uske niyam yahan BANAYE NAHI GAYE — app ke apne
 * `canAssignTo` / `assignableUsers` hi lage hain. Jisko aap app me kaam nahi de sakte,
 * usko buddy se bhi nahi de sakte.
 */
import { AssistantAction } from '../../models/AssistantAction.js';
import { Task } from '../../models/Task.js';
import { can } from '../../lib/permissions.js';
import { ymdInTz } from '../../lib/time.js';
import { createTask, setStatus, canAssignAny, canAssignTo, assignableUsers } from '../task.service.js';
import { User } from '../../models/User.js';
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
  assign_task: {
    // Yahan permission nahi, ek SAWAAL hai. Delegation `can()` se nahi chalti — har
    // bande ke apne `taskAssign` field se chalti hai (mode ALL, ya chuni hui list).
    // Isliye gate wahi function hai jo app ka assign-button dikhata hai.
    gate: canAssignAny,
    label: 'Give someone a task',
    async propose(user, input) {
      const title = String(input.title || '').trim().slice(0, 200);
      if (title.length < 2) return { error: 'NEED_TITLE', message: 'What is the task?' };
      const q = String(input.person || '').trim().toLowerCase();
      if (q.length < 2) return { error: 'NEED_PERSON', message: 'Who should it go to?' };

      // SIRF un logon me se jinhe ye banda kaam de sakta hai — poore roster me se nahi.
      // Jo list me hai hi nahi, uska naam AI ke haath me aata hi nahi.
      const allowed = await assignableUsers(user);
      const words = q.split(/\s+/).filter(Boolean);
      const hits = allowed.filter((u) => {
        const n = u.name.toLowerCase();
        return n === q || words.every((w) => n.includes(w));
      });

      if (hits.length === 0) {
        // Naam roster me to hai par is bande ki pahunch me nahi — ye saaf kehna behtar
        // hai, warna lagta hai aadmi hi nahi hai aur banda naam dobara likhta rehta hai.
        const exists = await User.exists({ isActive: true, name: new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i') });
        return exists
          ? { error: 'NOT_ALLOWED', message: 'You cannot assign work to that person.' }
          : { error: 'NO_SUCH_PERSON', message: `No active employee matches "${input.person}".` };
      }
      if (hits.length > 1) {
        return {
          error: 'AMBIGUOUS',
          message: `More than one person matches "${input.person}" — ask which one.`,
          candidates: hits.slice(0, 6).map((u) => u.name),
        };
      }

      const due = YMD.test(input.due || '') ? input.due : '';
      if (due && due < today()) {
        return { error: 'PAST_DATE', message: 'That due date is already past — pick today or later.' };
      }
      const to = hits[0];
      return {
        payload: { assignTo: String(to.id), personName: to.name, title, dueYMD: due },
        summary: `Give ${to.name} a task: “${title}”${due ? `, due ${nice(due)}` : ' (no due date)'}`,
      };
    },
    async run(user, payload) {
      // Dobara jaanch: tajweez banne aur Confirm dabne ke beech me kisi ki pahunch badal
      // sakti hai, ya banda deactivate ho sakta hai.
      const target = await User.findOne({ _id: payload.assignTo, isActive: true });
      if (!target) throw httpError(404, 'NOT_FOUND', 'That person is no longer active.');
      if (!canAssignTo(user, target)) throw httpError(403, 'FORBIDDEN', 'You cannot assign work to that person.');
      // createTask apne andar bhi yahi jaanch dobara karti hai — teesra taala.
      const { tasks } = await createTask(user, { title: payload.title, dueYMD: payload.dueYMD || '', assignTo: [payload.assignTo] });
      return { assigned: payload.personName, task: tasks?.[0]?.title ?? payload.title };
    },
  },

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
/**
 * Jo kaam is bande ko diye ja sakte hain.
 *
 * `gate` ya to ek permission ka naam hai, ya ek SAWAAL (function). Delegation ke liye
 * sawaal chahiye tha: wo `can()` se nahi, har bande ke apne `taskAssign` se chalti hai.
 */
export const actionsFor = (user) =>
  Object.entries(ACTIONS).filter(([, a]) => {
    if (!a.gate) return true;
    return typeof a.gate === 'function' ? a.gate(user) : can(user, a.gate);
  });

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
  if (has('assign_task')) {
    out.push({
      name: 'propose_assign_task',
      description:
        'Prepare a task for SOMEONE ELSE. This does NOT create it — it returns something for the signed-in person to confirm. Only people they are allowed to delegate to; if the tool says they cannot, tell them so and stop.',
      input_schema: {
        type: 'object',
        properties: {
          person: { type: 'string', description: "The colleague's name as the user said it." },
          title: { type: 'string', description: 'What the task says.' },
          due: { type: 'string', description: 'Due date YYYY-MM-DD. Omit if they did not give one.' },
        },
        required: ['person', 'title'],
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
  const allowed = actionsFor(user).some(([key]) => key === kind);
  if (!allowed) return { error: 'NOT_ALLOWED', message: 'You do not have access to that.' };
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
  // Dobara — tajweez banne aur Confirm dabne ke beech me role ya pahunch badal sakti hai.
  if (!actionsFor(user).some(([key]) => key === doc.kind)) {
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
