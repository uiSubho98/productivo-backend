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
    // Profile phone number — set once by user, further changes require superadmin approval
    phoneNumber: {
      type: String,
      default: null,
      trim: true,
    },
    // Once the superadmin approves a change request, this is set to (now + 24h);
    // the user can update phoneNumber while this is in the future.
    phoneEditUntil: {
      type: Date,
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
// Unique phone number across all users. `sparse` so multiple users without phone don't collide.
userSchema.index({ phoneNumber: 1 }, { unique: true, sparse: true });

const User = mongoose.model('User', userSchema);

export default User;
