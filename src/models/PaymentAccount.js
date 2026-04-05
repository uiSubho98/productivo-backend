import mongoose from 'mongoose';

const paymentAccountSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    accountName: {
      type: String,
      required: [true, 'Account name is required'],
      trim: true,
    },
    type: {
      type: String,
      enum: ['bank', 'upi', 'qr'],
      required: [true, 'Account type is required'],
    },
    bankName: {
      type: String,
      default: null,
      trim: true,
    },
    accountNumber: {
      type: String,
      default: null,
      trim: true,
    },
    ifscCode: {
      type: String,
      default: null,
      trim: true,
    },
    accountHolderName: {
      type: String,
      default: null,
      trim: true,
    },
    upiId: {
      type: String,
      default: null,
      trim: true,
    },
    qrImageUrl: {
      type: String,
      default: null,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

paymentAccountSchema.index({ organizationId: 1 });

const PaymentAccount = mongoose.model('PaymentAccount', paymentAccountSchema);

export default PaymentAccount;
