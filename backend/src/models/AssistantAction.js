import mongoose from 'mongoose';

/**
 * Buddy ki ek TAJWEEZ — jo kaam wo karna chahta hai, par abhi kiya nahi.
 * (Plan: audits/15-ai-buddy-plan.md, Phase 3)
 *
 * YE SERVER PAR KYUN RAKHI JAATI HAI, CLIENT PAR KYUN NAHI
 *
 * Aasaan raasta ye hota ki buddy jawab ke saath hi poora kaam (kya, kiska, kitna) client
 * ko bhej de, aur Confirm dabane par client wahi wapas bhej de. Us raaste me beech ka
 * arsa khula rehta hai: jo wapas aaya wo WAHI hai jo dikhaya gaya tha, iski koi guarantee
 * nahi. Taarikh, raqam ya aadmi badal kar bheja ja sakta hai — user ne kuch aur dekh kar
 * haan kahi, aur hua kuch aur.
 *
 * Isliye tajweez yahan likhi jaati hai aur client ko sirf uska `id` milta hai. Confirm par
 * server apni hi likhi hui baat uthata hai. "Kya karna hai" client ke haath me kabhi
 * aata hi nahi, to usme chhed-chhaad ka sawaal hi nahi.
 *
 * Teen aur taale:
 *  - `user` — tajweez usi ki hai; kisi aur ka `id` kaam nahi aata
 *  - `status` — ek hi baar chalti hai; `DONE` ke baad dobara nahi
 *  - TTL — 15 minute baad apne aap mit jaati hai. Kal ki aadhi-adhuri baat par aaj
 *    galti se Confirm daba dena nahi chahiye.
 *
 * Aur `payload` me sirf SULJHI hui cheezein jaati hain — naam nahi, user ka id; "kal"
 * nahi, 2026-10-25. Sulajhna tajweez ke waqt hota hai, karne ke waqt nahi, taaki user ne
 * jo dekha aur jo hua, wo ek hi rahe.
 */
const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, required: true }, // 'create_task' | 'complete_task' | 'apply_leave'
    // Suljhe hue parameter — seedha service ko dene layak.
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Wahi ek line jo user ko dikhayi gayi thi. Confirm ke baad Activity log me yahi
    // jaati hai, taaki baad me pata chale ki bande ne haan KIS baat par kahi thi.
    summary: { type: String, default: '' },
    status: { type: String, enum: ['PENDING', 'DONE', 'CANCELLED'], default: 'PENDING', index: true },
    doneAt: { type: Date, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// 15 minute. Ek aadhi baat itni hi der tak "abhi ki" rehti hai.
schema.index({ createdAt: 1 }, { expireAfterSeconds: 15 * 60 });

export const AssistantAction =
  mongoose.models.AssistantAction || mongoose.model('AssistantAction', schema);
