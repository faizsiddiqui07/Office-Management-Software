import mongoose from 'mongoose';

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    notes: { type: String, default: '' },
    status: { type: String, enum: ['PENDING', 'DONE'], default: 'PENDING', index: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true }, // who does it
    assignedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true }, // set when delegated
    // Teammates tagged as also working on this task (a shared "project" task). The
    // owner keeps it in their own to-do; each collaborator sees it in "assigned to
    // me". Status is SHARED — whoever completes it, it's done for everyone.
    collaborators: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [], index: true },
    // Set (to a shared random id) when the SAME work is assigned to several people at
    // once — links those independent copies. Each person completes their OWN copy
    // (per-person completion); the batch is fully done only when everyone's is. The
    // link lets the assigner edit/reassign all copies together and each person see
    // their teammates' progress. Empty for personal / single-assign tasks.
    assignBatch: { type: String, default: '', index: true },
    // Approval gate (optional, set by the assigner): when true, the assignee marking
    // "done" SUBMITS for review instead of closing it — the assigner must approve
    // before it counts as done and moves to history.
    requiresApproval: { type: Boolean, default: false },
    submittedAt: { type: Date, default: null }, // when the assignee submitted for approval (also the on-time reference for bonus)
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // assigner who approved it
    rejectionReason: { type: String, default: '' }, // why the assigner last sent it back
    dueYMD: { type: String, default: '' }, // optional deadline (YYYY-MM-DD)
    // When the assignee first opened the task and read it — the delivered/read
    // distinction, so the person who assigned it knows it actually landed.
    seenAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // who actually did the work
  },
  { timestamps: true },
);

// "Waiting for the assigner's approval": submitted, not yet approved/rejected.
taskSchema.virtual('awaitingApproval').get(function awaiting() {
  return !!this.requiresApproval && this.status === 'PENDING' && !!this.submittedAt;
});

taskSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);
