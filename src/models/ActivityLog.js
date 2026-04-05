import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    method: { type: String, default: null },
    path: { type: String, default: null },
    statusCode: { type: Number, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userEmail: { type: String, default: null },
    userRole: { type: String, default: null },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    ip: { type: String, default: null },
    durationMs: { type: Number, default: null },
    type: {
      type: String,
      enum: ['api', 'email', 'whatsapp'],
      default: 'api',
    },
    // For email/whatsapp logs
    to: { type: String, default: null },
    subject: { type: String, default: null },
    success: { type: Boolean, default: true },
    errorMsg: { type: String, default: null },
  },
  { timestamps: true }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ type: 1, createdAt: -1 });
activityLogSchema.index({ organizationId: 1, createdAt: -1 });

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

export default ActivityLog;
