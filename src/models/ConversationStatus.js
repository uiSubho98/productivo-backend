import mongoose from 'mongoose';

const conversationStatusSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
      index: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
    },
    phone: {
      type: String,
      required: true,
    },
    displayName: {
      type: String,
      default: '',
    },
    unreadCount: {
      type: Number,
      default: 0,
    },
    lastMessageAt: {
      type: Date,
      default: null,
    },
    lastMessagePreview: {
      type: String,
      default: '',
    },
    lastMessageDirection: {
      type: String,
      enum: ['inbound', 'outbound'],
      default: 'inbound',
    },
    lastSeen: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

conversationStatusSchema.index({ phone: 1, organizationId: 1 }, { unique: true });
conversationStatusSchema.index({ organizationId: 1, lastMessageAt: -1 });

const ConversationStatus = mongoose.model('ConversationStatus', conversationStatusSchema);
export default ConversationStatus;
