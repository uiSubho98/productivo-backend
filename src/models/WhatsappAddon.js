import mongoose from 'mongoose';

export const ADDON_FEATURES = ['invoice', 'task_reminder', 'meeting_invite'];
export const ADDON_PRICES = {
  invoice: 499,
  task_reminder: 499,
  meeting_invite: 499,
  bundle: 1199,
};

const addonItemSchema = new mongoose.Schema(
  {
    feature: { type: String, enum: ADDON_FEATURES, required: true },
    expiresAt: { type: Date, required: true },
    purchaseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Purchase', default: null },
    activatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const whatsappAddonSchema = new mongoose.Schema(
  {
    superadminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    addons: { type: [addonItemSchema], default: [] },
  },
  { timestamps: true }
);

whatsappAddonSchema.methods.isFeatureActive = function (feature) {
  const entry = this.addons.find((a) => a.feature === feature);
  if (!entry) return false;
  return entry.expiresAt > new Date();
};

whatsappAddonSchema.methods.activateFeatures = function (features, { purchaseId, durationDays = 365 }) {
  const now = Date.now();
  for (const feature of features) {
    if (!ADDON_FEATURES.includes(feature)) continue;
    const existing = this.addons.find((a) => a.feature === feature);
    const base = existing && existing.expiresAt > new Date() ? existing.expiresAt.getTime() : now;
    const newExpiry = new Date(base + durationDays * 24 * 60 * 60 * 1000);
    if (existing) {
      existing.expiresAt = newExpiry;
      existing.purchaseId = purchaseId || existing.purchaseId;
      existing.activatedAt = new Date();
    } else {
      this.addons.push({
        feature,
        expiresAt: newExpiry,
        purchaseId: purchaseId || null,
        activatedAt: new Date(),
      });
    }
  }
};

whatsappAddonSchema.methods.toStatus = function () {
  const now = new Date();
  const map = {};
  for (const f of ADDON_FEATURES) {
    const entry = this.addons.find((a) => a.feature === f);
    map[f] = {
      isActive: !!(entry && entry.expiresAt > now),
      expiresAt: entry?.expiresAt || null,
    };
  }
  return map;
};

const WhatsappAddon = mongoose.model('WhatsappAddon', whatsappAddonSchema);
export default WhatsappAddon;
