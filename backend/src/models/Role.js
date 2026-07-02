import mongoose from 'mongoose';

const roleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, uppercase: true, trim: true },
    label: { type: String, required: true, trim: true },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: false }, // built-in roles can't be deleted
    rank: { type: Number, default: 100 }, // display order
    // Task delegation targets: role keys this role may assign work to. EMPTY
    // means the default rule (anyone strictly below in the rank hierarchy).
    taskAssignRoles: { type: [String], default: [] },
  },
  { timestamps: true },
);

roleSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Role = mongoose.models.Role || mongoose.model('Role', roleSchema);
