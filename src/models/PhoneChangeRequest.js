import mongoose from 'mongoose';

/**
 * A user requests permission to change their phone number.
 * The superadmin of their org approves or rejects.
 * On approval, User.phoneEditUntil = now + 24h — during this window the user
 * can save a new phone number via PATCH /auth/profile/phone.
 */
const phoneChangeRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
    },
    // Superadmin this request is routed to
    superadminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    currentPhone: { type: String, default: null },
    reason: { type: String, default: '', maxlength: 300 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewNote: { type: String, default: '', maxlength: 300 },
  },
  { timestamps: true }
);

phoneChangeRequestSchema.index({ superadminId: 1, status: 1, createdAt: -1 });

export default mongoose.model('PhoneChangeRequest', phoneChangeRequestSchema);
