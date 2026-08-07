import mongoose from 'mongoose';

/**
 * One section of the office Rules & Regulations page — a titled group of rules
 * ("Attendance & Timing", "Leaves", …) so someone looking for the overtime rules reads
 * only that section instead of one long wall of text.
 *
 * Rule text may contain {placeholders} ({workStart}, {onTimePoints}, …) that are resolved
 * LIVE per viewer when the list is served — point values come from the bonus settings and
 * timings from the viewer's own shift, so the page never goes stale when Settings change.
 * Managed (add/edit/delete) by the owner role only; everyone can read.
 */
const ruleSectionSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 80 },
    // Lucide icon name rendered by the frontend (from a fixed allow-list there).
    icon: { type: String, default: 'BookOpen', maxlength: 40 },
    order: { type: Number, default: 0 },
    rules: {
      type: [{ text: { type: String, required: true, trim: true, maxlength: 600 } }],
      default: [],
    },
  },
  { timestamps: true },
);

ruleSectionSchema.set('toJSON', {
  virtuals: true,
  versionKey: false,
  transform: (_doc, ret) => {
    ret.id = String(ret._id);
    delete ret._id;
    if (Array.isArray(ret.rules)) {
      ret.rules = ret.rules.map((r) => ({ id: String(r._id), text: r.text }));
    }
    return ret;
  },
});

export const RuleSection = mongoose.model('RuleSection', ruleSectionSchema);
