import mongoose from 'mongoose';

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, default: '' }, // plain/rich text — rendered escaped on the client
    priority: { type: String, enum: ['NORMAL', 'IMPORTANT', 'URGENT'], default: 'NORMAL', index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    audienceRoles: { type: [String], default: [] }, // empty = everyone
    isActive: { type: Boolean, default: true },
    publishAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

announcementSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Announcement =
  mongoose.models.Announcement || mongoose.model('Announcement', announcementSchema);
