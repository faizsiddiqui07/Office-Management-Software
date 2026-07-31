import mongoose from 'mongoose';

const visitorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // visitor's name
    phone: { type: String, default: '' },
    category: { type: String, required: true, index: true }, // 'Visitors' | 'Finance' | custom
    fromPlace: { type: String, default: '' }, // where they came from
    company: { type: String, default: '' }, // who they are / company
    toMeet: { type: String, default: '' }, // whom they came to meet (free text)
    // The registered employee the visitor came to meet, when the "whom to meet"
    // typeahead resolved to one. Lets the host be alerted on arrival — but only if that
    // host can actually open the visitor register (see visitor.service maybeAlertHost).
    toMeetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    purpose: { type: String, default: '' }, // notes / reason
    dateYMD: { type: String, required: true, index: true }, // visit date (company TZ)
    date: { type: Date, required: true },
    checkInTime: { type: String, default: '' }, // 'HH:mm' company time
    checkOutTime: { type: String, default: '' }, // 'HH:mm'
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

visitorSchema.set('toJSON', { virtuals: true, versionKey: false });

export const Visitor = mongoose.models.Visitor || mongoose.model('Visitor', visitorSchema);
