import mongoose from 'mongoose';

/**
 * One message in one conversation.
 *
 * `body` is a Buffer, not a String, and it is ENCRYPTED (secretBox.sealBytes) before it
 * gets here. Two reasons, both deliberate:
 *   - a database or backup leak hands over ciphertext, not the company's conversations;
 *   - bytes, because base64 costs +33% on every message and messages are the one thing
 *     in this app that grow without limit.
 * The key lives in the environment, never in the database, so reading the collection is
 * not enough to read the chat.
 *
 * `participants` is copied down from the conversation on purpose. Every read of a message
 * filters on it, so a route that forgets to join back to the Conversation still cannot
 * serve somebody else's message — the filter is on the document being read.
 *
 * `seq` is the per-conversation position (1, 2, 3…), handed out by $inc on
 * Conversation.lastSeq. Ordering never depends on createdAt: two messages inside the same
 * millisecond, or a clock that drifts, would otherwise shuffle the conversation.
 */
const messageSchema = new mongoose.Schema(
  {
    conversation: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
    seq: { type: Number, required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Denormalised from the conversation — the authorization filter for every read.
    participants: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], required: true },
    kind: { type: String, enum: ['TEXT', 'FILE'], default: 'TEXT' },
    body: { type: Buffer, default: null }, // encrypted; null for a file-only message
    /**
     * A quoted reply. The quoted text is stored again (encrypted) rather than looked up
     * by seq, so the bubble renders from one document — and so editing or deleting the
     * original doesn't rewrite history inside a reply that already quoted it.
     */
    replyTo: {
      seq: { type: Number, default: null },
      sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
      preview: { type: Buffer, default: null },
      _id: false,
    },
    // "Delete for me": the sender or the receiver hides it from their own view; the other
    // side is untouched. Delete-for-everyone is a later phase and will clear `body`.
    deletedFor: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], default: [] },
    editedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Paging one conversation newest-first, and the unique guard on (conversation, seq) that
// makes a retried send impossible to store twice.
messageSchema.index({ conversation: 1, seq: -1 }, { unique: true });

messageSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
