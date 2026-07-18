import mongoose from 'mongoose';

const expenseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    // Stored as integer minor units (e.g. paise) to avoid float errors.
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    category: { type: String, default: 'MISC', index: true },
    date: { type: Date, required: true },
    dateYMD: { type: String, required: true, index: true },
    paymentMethod: { type: String, enum: ['CASH', 'CARD', 'UPI', 'BANK_TRANSFER', 'OTHER'], default: 'CASH' },
    vendor: { type: String, default: '' },
    notes: { type: String, default: '' },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

expenseSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Expense = mongoose.models.Expense || mongoose.model('Expense', expenseSchema);
