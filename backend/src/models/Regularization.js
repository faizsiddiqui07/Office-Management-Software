import mongoose from 'mongoose';

/**
 * An employee's request to correct their attendance for a past day (forgot to
 * check in/out, wrong time). Approved by leadership → applied to the record.
 */
const regularizationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    dateYMD: { type: String, required: true },
    date: { type: Date, required: true },
    requestedCheckIn: { type: String, default: null }, // 'HH:mm' (company time)
    requestedCheckOut: { type: String, default: null }, // 'HH:mm'
    reason: { type: String, required: true },
    status: {
      type: String,
      // CANCELLED = bande ne khud wapas le li, kisi ke decide karne se PEHLE. Ye
      // "reject" nahi hai: reject ek faisla hai, ye faisle se pehle ki wapsi hai —
      // dono ko ek hi khaane me daalna galat hota. Leave me bhi yahi naam hai.
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, default: '' },
    // Pending rehte hue banda apni request badal sakta hai. Ye nishaan isliye hai ki
    // approver ko DIKHE ki badli gayi hai — warna wo jo screen par dekh chuka tha usi
    // bharose approve kar deta, jabki ab andar kuch aur likha hai.
    editedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

regularizationSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Regularization =
  mongoose.models.Regularization || mongoose.model('Regularization', regularizationSchema);
