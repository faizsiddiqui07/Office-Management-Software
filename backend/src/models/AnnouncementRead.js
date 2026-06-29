import mongoose from 'mongoose';

const announcementReadSchema = new mongoose.Schema(
  {
    announcement: { type: mongoose.Schema.Types.ObjectId, ref: 'Announcement', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    readAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

announcementReadSchema.index({ announcement: 1, user: 1 }, { unique: true });

export const AnnouncementRead =
  mongoose.models.AnnouncementRead || mongoose.model('AnnouncementRead', announcementReadSchema);
