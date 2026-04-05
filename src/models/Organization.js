import mongoose from 'mongoose';

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Organization name is required'],
      trim: true,
      maxlength: 200,
    },
    logo: {
      type: String,
      default: null,
    },
    cinNumber: {
      type: String,
      default: null,
      trim: true,
    },
    taxPercentage: {
      type: Number,
      default: 18,
      min: 0,
      max: 100,
    },
    address: {
      street: { type: String, default: '' },
      city: { type: String, default: '' },
      state: { type: String, default: '' },
      zipCode: { type: String, default: '' },
      country: { type: String, default: '' },
    },
    phone: {
      type: String,
      default: null,
    },
    website: {
      type: String,
      default: null,
    },
    adminIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  {
    timestamps: true,
  }
);

const Organization = mongoose.model('Organization', organizationSchema);

export default Organization;
