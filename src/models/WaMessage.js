import mongoose from 'mongoose';

const waMessageSchema = new mongoose.Schema(
  {
    waMessageId: {
      type: String,
      default: null,
      index: true,
    },
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
      index: true,
    },
    senderName: {
      type: String,
      default: '',
    },
    direction: {
      type: String,
      enum: ['inbound', 'outbound'],
      required: true,
    },
    type: {
      type: String,
      enum: ['text', 'document', 'image', 'template', 'audio', 'video', 'sticker', 'location', 'unknown'],
      default: 'text',
    },
    content: {
      text: { type: String, default: '' },
      document: {
        id: { type: String, default: '' },
        url: { type: String, default: '' },
        filename: { type: String, default: '' },
        mimeType: { type: String, default: '' },
        caption: { type: String, default: '' },
      },
      image: {
        id: { type: String, default: '' },
        url: { type: String, default: '' },
        caption: { type: String, default: '' },
      },
      template: {
        name: { type: String, default: '' },
        language: { type: String, default: '' },
      },
    },
    // sent → delivered → read (outbound); delivered (inbound)
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read', 'failed', 'pending'],
      default: 'pending',
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

waMessageSchema.index({ phone: 1, timestamp: -1 });
waMessageSchema.index({ organizationId: 1, timestamp: -1 });

const WaMessage = mongoose.model('WaMessage', waMessageSchema);
export default WaMessage;
