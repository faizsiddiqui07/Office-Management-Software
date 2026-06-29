import mongoose from 'mongoose';

/** A browser/device Web-Push subscription belonging to a user. */
const pushSubscriptionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, default: '' },
      auth: { type: String, default: '' },
    },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true },
);

pushSubscriptionSchema.set('toJSON', { virtuals: true, versionKey: false });

export const PushSubscription =
  mongoose.models.PushSubscription || mongoose.model('PushSubscription', pushSubscriptionSchema);
