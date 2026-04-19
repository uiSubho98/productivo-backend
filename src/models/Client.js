import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Client name is required'],
      trim: true,
      maxlength: 200,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      default: null,
    },
    whatsappNumber: {
      type: String,
      default: null,
    },
    phoneNumber: {
      type: String,
      default: null,
    },
    address: {
      street: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      zipCode: { type: String, default: '' },
      country: { type: String, default: 'India' },
    },
    addressLat: { type: Number, default: null },
    addressLng: { type: Number, default: null },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    companyName: {
      type: String,
      default: null,
      trim: true,
    },
    logo: {
      type: String,
      default: null,
    },
    gstNumber: {
      type: String,
      default: null,
      trim: true,
    },
    cinNumber: {
      type: String,
      default: null,
      trim: true,
    },
    pipelineStage: {
      type: String,
      enum: ['lead', 'contacted', 'quotation_sent', 'quotation_revised', 'mvp_shared', 'converted', 'lost', 'inactive'],
      default: 'lead',
    },
    website: {
      type: String,
      default: null,
      trim: true,
    },
    source: {
      type: String,
      default: null,
      trim: true,
    },
    notes: [
      {
        text: { type: String, required: true },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    countryCode: {
      type: String,
      default: '+91',
    },
  },
  {
    timestamps: true,
  }
);

clientSchema.index({ organizationId: 1 });
clientSchema.index({ email: 1 }, { unique: true, sparse: true });
clientSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });

const Client = mongoose.model('Client', clientSchema);

export default Client;
