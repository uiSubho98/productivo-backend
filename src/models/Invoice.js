import mongoose from 'mongoose';

const invoiceItemSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    rate: {
      type: Number,
      required: true,
      min: 0,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: true }
);

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      required: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
    },
    items: [invoiceItemSchema],
    subtotal: {
      type: Number,
      required: true,
      min: 0,
    },
    taxPercentage: {
      type: Number,
      default: 18,
      min: 0,
      max: 100,
    },
    taxAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    total: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'],
      default: 'draft',
    },
    pdfUrl: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: '',
    },
    paymentAccountIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'PaymentAccount' }],
      default: [],
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'partial', 'paid'],
      default: 'unpaid',
    },
    payments: [
      {
        amount: {
          type: Number,
          required: true,
        },
        date: {
          type: Date,
          required: true,
        },
        method: {
          type: String,
          enum: ['bank_transfer', 'upi', 'cash', 'cheque', 'other'],
        },
        reference: {
          type: String,
          default: null,
        },
        notes: {
          type: String,
          default: null,
        },
        recordedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        updatedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          default: null,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
        updatedAt: {
          type: Date,
          default: null,
        },
      },
    ],
    activityLog: [
      {
        action: { type: String, required: true },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
        meta: { type: mongoose.Schema.Types.Mixed, default: null },
      },
    ],
    sentVia: [
      {
        type: String,
      },
    ],
    sentAt: {
      type: Date,
      default: null,
    },
    ccEmails: [
      {
        type: String,
      },
    ],
    version: {
      type: Number,
      default: 1,
      min: 1,
    },
    revisedFromId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Invoice',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

invoiceSchema.index({ organizationId: 1 });
invoiceSchema.index({ clientId: 1 });

const Invoice = mongoose.model('Invoice', invoiceSchema);

export default Invoice;
