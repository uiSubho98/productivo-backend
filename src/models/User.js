import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: 100,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: [true, 'Password is required'],
    },
    mpinHash: {
      type: String,
      default: null,
    },
    role: {
      type: String,
      enum: ['product_owner', 'superadmin', 'org_admin', 'employee'],
      default: 'employee',
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      default: null,
    },
    avatar: {
      type: String,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    whatsapp: {
      type: String,
      default: null,
    },
    biometricEnabled: {
      type: Boolean,
      default: false,
    },
    mpinEnabled: {
      type: Boolean,
      default: false,
    },
    resetOtp: {
      type: String,
      default: null,
    },
    resetOtpExpiry: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ organizationId: 1 });

const User = mongoose.model('User', userSchema);

export default User;
