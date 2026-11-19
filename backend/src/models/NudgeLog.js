import mongoose from 'mongoose';

/**
 * "Ye yaad bhej di ja chuki hai" ka pakka nishaan.
 *
 * KYUN EK ALAG COLLECTION: scheduler har kuch minute chalta hai aur Lambda ke do container
 * saath me jaag sakte hain. `Notification.exists(...)` padh kar bhejna race hai — dono
 * padhte hain "nahi gayi", dono bhej dete hain, aur bande ke phone par ek hi baat do baar
 * aati hai. Announcements me theek yahi ho chuka hai, isliye wahan bhi claim-stamp lagana
 * pada tha (dekho announcement.service ka digestLastRun/claim).
 *
 * Yahan claim khud INSERT hai: `key` par unique index hai, to do container me se jo pehle
 * insert kar paata hai wahi bhejta hai; doosre ko duplicate-key (11000) milti hai aur wo
 * chup-chaap haath kheench leta hai. Padh kar faisla karne wala koi step hi nahi hai.
 *
 * Key me wo sab daalo jiske badalne par yaad DOBARA aani chahiye — jaise task ki due
 * date. `due:<taskId>:<dueYMD>` ka matlab: is task ki IS due date ke liye ek baar. Due
 * date aage badh gayi to key badal jaati hai aur nayi yaad aa jaati hai, jo theek hai.
 *
 * TTL 90 din: nishaan ka kaam sirf "dobara mat bhejo" hai, itihaas rakhna nahi.
 */
const nudgeLogSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

nudgeLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export const NudgeLog = mongoose.models.NudgeLog || mongoose.model('NudgeLog', nudgeLogSchema);

/**
 * Is kaam ko MERE naam par claim karo. `true` matlab "tum bhejo"; `false` matlab "koi aur
 * bhej chuka hai ya bhej raha hai".
 *
 * Insert fail hone ki ek hi wajah manzoor hai — duplicate key (11000). Koi aur gadbad
 * (DB band, index hi nahi bana) par `false` lautta hai: yaad na jaana chalega, do baar
 * jaana nahi.
 */
export async function claimNudge(key) {
  try {
    await NudgeLog.create({ key });
    return true;
  } catch (err) {
    if (err?.code !== 11000) console.error('claimNudge failed:', err?.message);
    return false;
  }
}
