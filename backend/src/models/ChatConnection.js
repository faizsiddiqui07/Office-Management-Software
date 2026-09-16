import mongoose from 'mongoose';

/**
 * Ek khula WebSocket — yaani ek tab jo abhi chat sun raha hai.
 *
 * Ek banda, kai rows: har khula tab apna alag connection hai. Message bhejte waqt
 * uske SAARE connections par bheja jaata hai, warna do tab khole hue bande ko ek me
 * message dikhta aur doosre me nahi.
 *
 * `expiresAt` par TTL index hai, aur ye is collection ke liye zaroori hai — koi bewakoofi
 * nahi. API Gateway ka $disconnect "best effort" hai: network kat gaya, laptop band ho
 * gaya, ya browser crash hua to wo kabhi chalta hi nahi. Bina TTL ke ye collection mare
 * hue connections se bharti jaati aur har message par unko bhejne ki bekaar koshish hoti
 * (har koshish billable). TTL 2 ghante ka hai kyunki API Gateway khud bhi kisi connection
 * ko 2 ghante se zyada zinda nahi rakhta — uske baad wo row jhooth hi hai.
 *
 * Presence (online / last seen) ke liye koi alag collection NAHI: "is bande ki koi row
 * hai ya nahi" — bas yahi online hona hai. Har 30 second ek write karke green dot dikhana
 * free database tier par sabse mehengi cosmetic galti hoti.
 */
const chatConnectionSchema = new mongoose.Schema(
  {
    connectionId: { type: String, required: true, unique: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Keepalive isko aage badhata hai; TTL isi par chalta hai.
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: Date.now },
    // Ye tab is waqt kaun si chat khole baithi hai — isse hi tay hota hai ki push bhejna
    // hai ya nahi (jo chat saamne khuli hai uska notification bhejna bakwas hai).
    activeConversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
    userAgent: { type: String, default: '' },
  },
  { timestamps: true },
);

chatConnectionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ChatConnection =
  mongoose.models.ChatConnection || mongoose.model('ChatConnection', chatConnectionSchema);
