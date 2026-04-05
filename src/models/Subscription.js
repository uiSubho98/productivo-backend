import mongoose from 'mongoose';

/**
 * Subscription tracks each superadmin's active plan.
 * Free plan has no expiry. Pro plan has a 1-year expiry from payment date.
 *
 * Limits enforced server-side for 'free' plan:
 *   - clients:   3 (lifetime total)
 *   - projects:  5 (active)
 *   - invoices:  3 (lifetime total)
 *   - tasks:     unlimited
 *   - users:     10 total members across all orgs (including the superadmin themselves)
 *   - sub-orgs:  0 (cannot create child organisations)
 */

export const PLANS = {
  free: {
    name: 'Starter',
    clients: 3,
    projects: 5,
    invoices: 3,
    tasks: Infinity,
    users: 10, // includes superadmin
    subOrgs: 0,
  },
  pro: {
    name: 'Pro',
    clients: Infinity,
    projects: Infinity,
    invoices: Infinity,
    tasks: Infinity,
    users: Infinity,
    subOrgs: Infinity,
  },
  enterprise: {
    name: 'Enterprise',
    clients: Infinity,
    projects: Infinity,
    invoices: Infinity,
    tasks: Infinity,
    users: Infinity,
    subOrgs: Infinity,
  },
};

const subscriptionSchema = new mongoose.Schema(
  {
    // The superadmin who owns this subscription
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    plan: {
      type: String,
      enum: ['free', 'pro', 'enterprise'],
      default: 'free',
    },
    status: {
      type: String,
      enum: ['active', 'expired', 'cancelled'],
      default: 'active',
    },
    // null for free (never expires), Date for paid
    expiresAt: {
      type: Date,
      default: null,
    },
    // Linked purchase record when plan = pro / enterprise
    purchaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Purchase',
      default: null,
    },
    // Track monthly invoice usage for free plan
    invoiceMonthCount: {
      type: Number,
      default: 0,
    },
    invoiceMonthYear: {
      // 'YYYY-MM' string, reset when month changes
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

subscriptionSchema.index({ userId: 1 });

/**
 * Returns true if the subscription is currently active and not expired.
 */
subscriptionSchema.methods.isActive = function () {
  if (this.status !== 'active') return false;
  if (this.plan === 'free') return true;
  if (!this.expiresAt) return true;
  return new Date() < this.expiresAt;
};

/**
 * Returns the limits object for this subscription's plan.
 * Falls back to free limits if plan is expired.
 */
subscriptionSchema.methods.getLimits = function () {
  if (!this.isActive() || this.plan === 'free') return PLANS.free;
  return PLANS[this.plan] || PLANS.free;
};

const Subscription = mongoose.model('Subscription', subscriptionSchema);
export default Subscription;
