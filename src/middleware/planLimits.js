/**
 * Plan limits middleware.
 *
 * Usage in routes:
 *   router.post('/', authenticate, requireOrg, checkLimit('clients'), create);
 *
 * Supported resources: 'clients' | 'projects' | 'invoices' | 'users' | 'subOrgs'
 *
 * How it works:
 *   1. Finds the subscription for the superadmin who owns the user's org.
 *   2. Compares current count against the plan limit.
 *   3. Returns 403 with { code: 'PLAN_LIMIT', resource, limit, current } if exceeded.
 */

import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import Invoice from '../models/Invoice.js';
import User from '../models/User.js';

/**
 * Resolve the superadminId for the requesting user.
 * - superadmin  → their own _id
 * - org_admin / employee → look up their org's superadminId
 */
async function resolveSuperadminId(user) {
  if (user.role === 'superadmin') return user._id;
  if (!user.organizationId) return null;
  const org = await Organization.findById(user.organizationId).select('superadminId').lean();
  return org?.superadminId || null;
}

/**
 * Get or create a subscription for the given superadminId.
 */
export async function getSubscription(superadminId) {
  let sub = await Subscription.findOne({ userId: superadminId });
  if (!sub) {
    sub = await Subscription.create({ userId: superadminId, plan: 'free' });
  }
  return sub;
}

/**
 * Count current usage for a resource under the superadmin's org tree.
 */
async function countUsage(resource, superadminId, subscription) {
  // Get all org IDs owned by this superadmin
  const orgs = await Organization.find({ superadminId }).select('_id').lean();
  const orgIds = orgs.map((o) => o._id);

  switch (resource) {
    case 'clients':
      return Client.countDocuments({ organizationId: { $in: orgIds } });

    case 'projects':
      return Project.countDocuments({ organizationId: { $in: orgIds }, status: { $ne: 'archived' } });

    case 'invoices': {
      // Lifetime total count of all invoices (not monthly) for free plan
      return Invoice.countDocuments({ organizationId: { $in: orgIds } });
    }

    case 'users': {
      // Count all active members across owned orgs + the superadmin themselves
      const memberCount = await User.countDocuments({
        organizationId: { $in: orgIds },
        isActive: true,
        role: { $ne: 'product_owner' },
      });
      return memberCount + 1; // +1 for the superadmin themselves
    }

    case 'subOrgs':
      // Count child orgs (parentOrgId != null) under this superadmin
      return Organization.countDocuments({
        superadminId,
        parentOrgId: { $ne: null },
      });

    default:
      return 0;
  }
}

/**
 * Middleware factory.
 * @param {string} resource — one of: clients | projects | invoices | users | subOrgs
 */
export function checkLimit(resource) {
  return async (req, res, next) => {
    try {
      // product_owner has no plan limits
      if (req.user.role === 'product_owner') return next();

      const superadminId = await resolveSuperadminId(req.user);
      if (!superadminId) return next(); // no org yet, will be caught by requireOrg

      const subscription = await getSubscription(superadminId);
      const limits = subscription.getLimits();

      const limit = limits[resource];
      if (limit === Infinity || limit === undefined) return next(); // unlimited

      const current = await countUsage(resource, superadminId, subscription);

      if (current >= limit) {
        return res.status(403).json({
          success: false,
          error: `You've reached the ${resource} limit for your ${subscription.plan} plan.`,
          code: 'PLAN_LIMIT',
          resource,
          limit,
          current,
          plan: subscription.plan,
          upgrade: true,
        });
      }

      // Attach subscription to req for downstream use (e.g. invoice counter increment)
      req.subscription = subscription;
      req.superadminId = superadminId;
      next();
    } catch (err) {
      console.error('planLimits middleware error:', err);
      next(); // fail open — don't block on middleware error
    }
  };
}

/**
 * Call after successfully creating an invoice to increment the monthly counter.
 */
export async function incrementInvoiceCount(subscription) {
  if (!subscription) return;
  const month = currentMonth();
  if (subscription.invoiceMonthYear !== month) {
    subscription.invoiceMonthYear = month;
    subscription.invoiceMonthCount = 1;
  } else {
    subscription.invoiceMonthCount += 1;
  }
  await subscription.save();
}
