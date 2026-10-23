import mongoose from 'mongoose';

/**
 * Buddy ke saath ki gayi ek baat — sawaal ya jawab.
 * (Plan: audits/15-ai-buddy-plan.md, Phase 4)
 *
 * `body` **Buffer hai, String nahi, aur ENCRYPTED hai** — bilkul wahi tareeka jo chat ke
 * `Message.body` par pehle se laga hai (`secretBox.sealBytes`). Database ya backup kabhi
 * leak ho to haath me ciphertext aaye, logon ki baatein nahi.
 *
 * **Ye "sirf aap padh sakte hain" wala taala NAHI hai.** Chaabi Lambda ke environment me
 * rehti hai, to app khud padh sakti hai — warna aapko doosre phone par apni hi history
 * dikhti hi nahi. Jo bachaav chahiye tha wo DB-leak se hai, aur wo ye deta hai.
 *
 * **Chaabi kabhi mat badalna.** `APP_ENC_KEY` / `JWT_SECRET` badla, to 90 din ki saari
 * baatein hamesha ke liye band. Yahi khatra SMTP password aur chat par pehle se hai.
 *
 * **90 din baad apne aap mit jaati hai** (owner ka faisla). TTL `createdAt` par hai —
 * wo khula padta hai, encrypted sirf baat ka matn hai, isliye Mongo use mita sakta hai.
 *
 * Ek baat jo is design ne CHHOD di hai: encrypted matn me **search nahi ho sakta**.
 * "Wo chat dhoondho jisme maine X poocha tha" kabhi kaam nahi karega — ye keemat
 * jaan-bujh kar di gayi hai.
 */
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ['user', 'buddy'], required: true },
    body: { type: Buffer, required: true }, // encrypted
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Ek bande ki baatein, nayi se purani — history aur scroll-upar dono isi se chalte hain.
schema.index({ user: 1, createdAt: -1 });
// 90 din (owner ka faisla, 24 Oct 2026).
schema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const AssistantMessage =
  mongoose.models.AssistantMessage || mongoose.model('AssistantMessage', schema);
