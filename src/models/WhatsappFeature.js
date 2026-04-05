import mongoose from 'mongoose';

/**
 * WhatsappFeature — tracks whether the WhatsApp feature is unlocked for a
 * given superadmin (and therefore all orgs they own).
 *
 * Managed exclusively by product_owner via /api/v1/feature-flags/whatsapp.
 *
 * isEnabled  : true = unlocked, false = locked
 * expiresAt  : null = never expires, otherwise the cutoff Date
 *
 * At runtime, the effective state is:
 *   enabled AND (expiresAt === null OR expiresAt > now)
 */
const whatsappFeatureSchema = new mongoose.Schema(
  {
    // One record per superadmin user
    superadminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isEnabled: {
      type: Boolean,
      default: false,
    },
    // null = never expires
    expiresAt: {
      type: Date,
      default: null,
    },
    // Human-readable label for the expiry choice (never / 1w / 3m / 6m / custom)
    expiryLabel: {
      type: String,
      enum: ['never', '1_week', '3_months', '6_months', 'custom'],
      default: 'never',
    },
    // Who last changed it and when
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // Short note for the product_owner dashboard
    note: {
      type: String,
      default: '',
      maxlength: 300,
    },
  },
  { timestamps: true }
);

whatsappFeatureSchema.index({ superadminId: 1 });

/**
 * Virtual: is the feature currently active?
 * true only when isEnabled = true AND (expiresAt is null OR not yet expired)
 */
whatsappFeatureSchema.virtual('isActive').get(function () {
  if (!this.isEnabled) return false;
  if (!this.expiresAt) return true;
  return new Date() < this.expiresAt;
});

whatsappFeatureSchema.set('toJSON', { virtuals: true });
whatsappFeatureSchema.set('toObject', { virtuals: true });

const WhatsappFeature = mongoose.model('WhatsappFeature', whatsappFeatureSchema);

export default WhatsappFeature;
