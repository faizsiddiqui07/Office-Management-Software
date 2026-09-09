import mongoose from 'mongoose';

/**
 * Personal "dues" ledger between the Admin Manager (who buys lunch/runs errands)
 * and each user. A person's running balance = Σ(PAYMENT) − Σ(DUE):
 *   balance < 0 → they owe that much (pending)
 *   balance > 0 → they have that much advance/credit (future dues draw from it)
 *   balance = 0 → settled
 *
 * THREE kinds, and the third one is easy to get wrong:
 *   DUE        — something was bought for them.
 *   PAYMENT    — cash handed over as credit. Covers the oldest unpaid dues, and
 *                whatever is left over is their advance.
 *   SETTLEMENT — a RECEIPT, not money in the pool. When an item is settled the cash is
 *                already recorded on that due's own `paid` field, so counting a
 *                SETTLEMENT again would inflate the balance by exactly that amount.
 *                It exists purely so the history shows the money arriving — without it
 *                the cash is invisible and the ledger cannot be added up by hand,
 *                which is how ₹3,257 of real payments came to be missing from the
 *                screen while every balance was still correct.
 */
const ledgerEntrySchema = new mongoose.Schema(
  {
    person: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['DUE', 'PAYMENT', 'SETTLEMENT'], required: true, index: true },
    amount: { type: Number, required: true, min: 1 }, // integer minor units (paise)
    paid: { type: Number, default: 0, min: 0 }, // DUE: cash settled directly against this item (paise)
    settles: { type: mongoose.Schema.Types.ObjectId, ref: 'LedgerEntry', default: null }, // SETTLEMENT: the due it paid off (null = a settle-all)
    item: { type: String, default: '' }, // DUE: what was brought
    source: { type: String, default: '' }, // DUE: where it was brought from
    // Company-TZ midnight instant + its yyyy-MM-dd string.
    date: { type: Date, required: true },
    dateYMD: { type: String, required: true, index: true },
    note: { type: String, default: '' },
  },
  { timestamps: true },
);

ledgerEntrySchema.set('toJSON', { virtuals: true, versionKey: false });

export const LedgerEntry =
  mongoose.models.LedgerEntry || mongoose.model('LedgerEntry', ledgerEntrySchema);
