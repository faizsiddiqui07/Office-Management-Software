import mongoose from 'mongoose';

/**
 * DEADLINE AAKHRI BAAR KISNE KHISKAYI (owner ka faisla, 26 Nov 2026).
 *
 * Sirf AAKHRI badlaav rakha jaata hai, poora itihaas nahi — owner ne yahi chuna. Dobara
 * date badalne par ye stamp bas upar se likh diya jaata hai.
 *
 * `from` khaali ho sakta hai (pehle koi date thi hi nahi) aur `to` bhi (date hata di gayi) —
 * dono soorat asli hain, to dono par khaali string chalti hai. `at` ke null hone ka matlab
 * hai ki is task par deadline kabhi badli hi nahi; poora `dueChange` tab null rehta hai.
 */
const dueChangeSchema = new mongoose.Schema(
  {
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    from: { type: String, default: '' }, // 'YYYY-MM-DD', ya khaali
    to: { type: String, default: '' },
    at: { type: Date, default: null },
  },
  { _id: false },
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['PENDING', 'DONE'], default: 'PENDING', index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // who does it
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true }, // set when delegated
    // This task WAS delegated, but the person who delegated it has since been deleted, so
    // `assignedBy` had to be cleared to keep the reference valid. Without this marker the
    // task is indistinguishable from a personal one, and the rewards housekeeping pass
    // read it as "the task is gone" and hard-deleted the points the DOER had earned on it.
    assignerDeleted: { type: Boolean, default: false },
    // Teammates tagged as also working on this task (a shared "project" task). The
    // owner keeps it in their own to-do; each collaborator sees it in "assigned to
    // me". Status is SHARED — whoever completes it, it's done for everyone.
    collaborators: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [], index: true },
    // Deadline aakhri baar kisne khiskayi — upar dueChangeSchema dekho. `null` = kabhi nahi badli.
    dueChange: { type: dueChangeSchema, default: null },
    // Set (to a shared random id) when the SAME work is assigned to several people at
    // once — links those independent copies. Each person completes their OWN copy
    // (per-person completion); the batch is fully done only when everyone's is. The
    // link lets the assigner edit/reassign all copies together and each person see
    // their teammates' progress. Empty for personal / single-assign tasks.
    assignBatch: { type: String, default: '', index: true },
    // Approval gate (optional, set by the assigner): when true, the assignee marking
    // "done" SUBMITS for review instead of closing it. The assigner — or anyone TAGGED
    // on the task (owner's rule, 8 Sep 2026) — must approve before it counts as done and
    // moves to history. Who exactly, and who is excluded for having done the work
    // themselves, is decided in one place: lib/taskApprovers.js.
    requiresApproval: { type: Boolean, default: false },
    submittedAt: { type: Date, default: null }, // when the assignee submitted for approval (also the on-time reference for bonus)
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // whoever signed it off — the assigner, or a tagged colleague
    rejectionReason: { type: String, default: '' }, // why it was last sent back
    // Optional deadline (YYYY-MM-DD). Indexed because three scheduled passes narrow on it
    // every few minutes — the overdue penalty scan, the deadline reminders, and the
    // owner's own "yaad dilana" times below.
    dueYMD: { type: String, default: '', index: true },
    // ── "Yaad dilana" (owner ka faisla, 19 Nov 2026 — idea I43) ────────────────
    // Due wale din in waqton par is task ke MAALIK ko push + bell. Company time ('HH:mm'),
    // zyada se zyada 3 (owner ne yahi hadd chuni) — ek din me isse zyada ghanti sirf
    // chidh banati hai, aur ek hi tick me saikdon push Lambda ke 30s me nahi samaate.
    // Khaali list = koi reminder nahi. Sirf maalik ko jaati hai, dene wale ko nahi:
    // use overdue wali alag ghanti pehle se milti hai (taskReminder.service).
    remindTimes: { type: [String], default: [] },
    // Due se EK DIN pehle bhi, unhi waqton par.
    remindDayBefore: { type: Boolean, default: false },
    // Forwarding: a manager passes work down but stays on the hook for it. The copy
    // they were given stays in their list and only closes once this child does —
    // through their own approval if they asked for one, then their assigner's.
    forwardedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null, index: true },
    // The very first person who set this work in motion, carried down the chain so a
    // forwarded task can always say where it originally came from.
    originalAssignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // When the assignee first opened the task and read it — the delivered/read
    // distinction, so the person who assigned it knows it actually landed.
    seenAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // who actually did the work
  },
  { timestamps: true },
);

// "Waiting to be signed off": submitted, not yet approved/rejected.
taskSchema.virtual('awaitingApproval').get(function awaiting() {
  return !!this.requiresApproval && this.status === 'PENDING' && !!this.submittedAt;
});

taskSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);
