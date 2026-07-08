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
    // Set (to a shared random id) when the SAME work is assigned to several people
    // at once — links those independent copies so the assigner can edit them all in
    // one go. Empty for personal / single-assign tasks. Status stays per-person.
    assignBatch: { type: String, default: '', index: true },
    dueYMD: { type: String, default: '' }, // optional deadline (YYYY-MM-DD)
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

taskSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Task = mongoose.models.Task || mongoose.model('Task', taskSchema);
