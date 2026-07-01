import mongoose from 'mongoose';

const holidaySchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: ['HOLIDAY', 'EVENT', 'OPTIONAL_HOLIDAY', 'BIRTHDAY'], default: 'HOLIDAY', index: true },
    // Company-TZ midnight instants + yyyy-MM-dd strings (supports single or multi-day).
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    startYMD: { type: String, required: true, index: true },
    endYMD: { type: String, required: true },
    description: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

holidaySchema.set('toJSON', { virtuals: true, versionKey: false });

export const Holiday = mongoose.models.Holiday || mongoose.model('Holiday', holidaySchema);
