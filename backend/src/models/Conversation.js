import mongoose from 'mongoose';

/**
 * One chat thread between two people.
 *
 * Everything about "where each person is in this chat" lives INSIDE this document as a
 * two-entry `members` array rather than in a separate collection. That is a deliberate
 * capacity decision: a per-person-per-message receipt collection (the shape
 * AnnouncementRead.js uses) would double the row count of the busiest collection in the
 * app, and on the free database tier that alone fills the quota inside a year. For a 1:1
 * chat there are exactly two members, so an embedded array answers "my chat list", "my
 * unread count" and "has he read it" without a single extra query.
 *
 * `lastSeq` is the per-conversation message counter. Sending a message bumps it with
 * $inc in the SAME update that stamps the preview and the other person's unread — one
 * round trip, and two people sending at once can never be handed the same number.
 */
const memberSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // How many messages this person hasn't opened yet. Denormalised so the chat list and
    // the floating button's badge are one read, not a count() per conversation.
    unread: { type: Number, default: 0 },
    // Watermarks, not per-message flags: everything up to this seq is delivered/read.
    // Two integers per person replace one row per message — see the note above.
    deliveredUpToSeq: { type: Number, default: 0 },
    readUpToSeq: { type: Number, default: 0 },
    // "Clear chat" for this person only: they see messages after this seq. The other
    // side keeps the whole history, exactly like WhatsApp.
    clearedUpToSeq: { type: Number, default: 0 },
    mutedUntil: { type: Date, default: null },
    lastReadAt: { type: Date, default: null },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['DIRECT'], default: 'DIRECT' },
    /**
     * The two user ids sorted and joined ("smallerId:largerId"), with a unique index.
     *
     * This is the one thing standing between us and a silent data-split bug: without it,
     * two people who message each other at the same moment each create their own thread
     * and from then on both see half the conversation. The unique index makes the second
     * insert fail so the loser can re-read the winner's.
     */
    pairKey: { type: String, required: true, unique: true },
    // Flat list for authorization — every chat query filters on this, never on _id alone.
    participants: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      required: true,
      validate: (v) => v.length === 2,
    },
    members: { type: [memberSchema], default: [] },
    lastSeq: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null, index: true },
    lastMessageBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // A short encrypted snippet for the chat list, so showing the list never has to read
    // the messages collection. Encrypted like the message itself — a database leak must
    // not hand over the last line of every conversation in the company.
    lastMessagePreview: { type: Buffer, default: null },
    lastMessageKind: { type: String, enum: ['TEXT', 'FILE'], default: 'TEXT' },
  },
  { timestamps: true },
);

// "My chats, newest first" — the one query the chat list makes.
conversationSchema.index({ participants: 1, lastMessageAt: -1 });

conversationSchema.set('toJSON', { virtuals: true, versionKey: false });

/** The canonical pair key for two user ids, in either order. */
export function pairKeyOf(a, b) {
  return [String(a), String(b)].sort().join(':');
}

export const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
