import mongoose from 'mongoose';

/**
 * "Is bande ko, is chat ke liye, abhi-abhi kitne notification bheje" — sirf itna yaad
 * rakhne ke liye.
 *
 * Kyun zaroori hai: koi 10 message bhej de to phone 10 baar bajna nahi chahiye. Pehle
 * message par poora notification (aur buzz), uske baad usi khidki me aane wale message
 * wahi notification ko CHUPCHAP badal dete hain — "3 naye message". WhatsApp bhi yahi
 * karta hai.
 *
 * TTL 2 minute: khidki khatam, ginti khatam. Yaani do message agar 10 minute ke faasle
 * par aayein to dono par alag-alag buzz hoga — aur wahi sahi hai.
 *
 * Ye ginti kahin dikhayi nahi jaati; sirf "bajana hai ya chupchap badalna hai" tay karti
 * hai. Isliye iska thoda galat hona bhi kisi ko nuksan nahi deta.
 */
const chatPushStateSchema = new mongoose.Schema(
  {
    // `<recipientId>:<conversationId>`
    key: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: false },
);

chatPushStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ChatPushState =
  mongoose.models.ChatPushState || mongoose.model('ChatPushState', chatPushStateSchema);
