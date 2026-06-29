import mongoose from 'mongoose';

/**
 * Personal "dues" ledger between the Admin Manager (who buys lunch/runs errands)
 * and each user. A person's running balance = Σ(PAYMENT) − Σ(DUE):
 *   balance < 0 → they owe that much (pending)
 *   balance > 0 → they have that much advance/credit (future dues draw from it)
 *   balance = 0 → settled
 */
const ledgerEntrySchema = new mongoose.Schema(
  {
    person: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['DUE', 'PAYMENT'], required: true, index: true },
    amount: { type: Number, required: true, min: 1 }, // integer minor units (paise)
    paid: { type: Number, default: 0, min: 0 }, // DUE: cash settled directly against this item (paise)
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
