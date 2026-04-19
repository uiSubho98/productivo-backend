/**
 * Subscription controller.
 *
 * GET  /api/v1/subscription          — current user's plan status
 * POST /api/v1/subscription/upgrade  — initiate Cashfree payment for Pro upgrade
 * POST /api/v1/subscription/activate — called internally after payment confirmed
 */

import Subscription from '../models/Subscription.js';
import Purchase from '../models/Purchase.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import Invoice from '../models/Invoice.js';
import { PLANS } from '../models/Subscription.js';
import * as cashfree from '../services/cashfreeService.js';

const PRO_AMOUNT = 1499;
const WEBHOOK_URL = 'https://www.productivo.in/api/v1/payments/webhook';

/**
 * GET /api/v1/subscription
 * Returns the current user's plan, limits, and usage summary.
 */
export const getSubscription = async (req, res) => {
  try {
    const user = req.user;

    // Resolve superadminId
    let superadminId = null;
    if (user.role === 'superadmin') {
      superadminId = user._id;
    } else if (user.organizationId) {
      const org = await Organization.findById(user.organizationId).select('superadminId').lean();
      superadminId = org?.superadminId || null;
    }

    if (!superadminId) {
      return res.status(200).json({
        success: true,
        data: { plan: 'free', status: 'active', expiresAt: null, limits: PLANS.free, isExpired: false },
      });
    }

    let sub = await Subscription.findOne({ userId: superadminId });
    if (!sub) sub = await Subscription.create({ userId: superadminId, plan: 'free' });

    const isExpired = !sub.isActive();
    const effectivePlan = isExpired ? 'free' : sub.plan;
    const limits = PLANS[effectivePlan] || PLANS.free;

    // Collect all org IDs owned by this superadmin for usage counts
    const ownedOrgs = await Organization.find({ superadminId }).select('_id').lean();
    const orgIds = ownedOrgs.map((o) => o._id);

    const [memberCount, clientCount, activeProjectCount, invoiceCount] = await Promise.all([
      User.countDocuments({ organizationId: { $in: orgIds }, isActive: true, role: { $ne: 'product_owner' } }),
      Client.countDocuments({ organizationId: { $in: orgIds } }),
      Project.countDocuments({ organizationId: { $in: orgIds }, status: { $ne: 'archived' } }),
      Invoice.countDocuments({ organizationId: { $in: orgIds } }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        plan: effectivePlan,
        rawPlan: sub.plan,
        status: sub.status,
        isExpired,
        expiresAt: sub.expiresAt,
        limits,
        planName: PLANS[effectivePlan]?.name || 'Starter',
        usage: {
          users: memberCount + 1, // +1 for superadmin
          clients: clientCount,
          projects: activeProjectCount,
          invoices: invoiceCount,
        },
      },
    });
  } catch (err) {
    console.error('getSubscription error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch subscription.' });
  }
};

/**
 * POST /api/v1/subscription/upgrade
 * Initiates a Cashfree Payment Link for upgrading to Pro.
 * Body: { name, email, phone }
 * Returns: { paymentUrl, purchaseId }
 */
export const initiateUpgrade = async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const userId = req.user.role === 'superadmin' ? req.user._id : null;

    if (!name || !email || !phone) {
      return res.status(400).json({ success: false, error: 'Name, email and phone are required.' });
    }

    const purchase = await Purchase.create({
      name,
      email,
      phone,
      plan: 'Pro',
      amount: PRO_AMOUNT,
      status: 'pending',
      type: 'upgrade',
      userId: userId || undefined,
    });

    const baseUrl = req.headers.origin || 'https://www.productivo.in';
    const returnUrl = `${baseUrl}/payment-success?pid=${purchase._id}&upgrade=1`;
    const linkId = `upgrade_${purchase._id}_${Date.now().toString(36)}`;

    const link = await cashfree.createPaymentLink({
      linkId,
      amount: PRO_AMOUNT,
      purpose: 'Productivo Pro Plan - 1 Year',
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      returnUrl,
      notifyUrl: WEBHOOK_URL,
    });

    purchase.cashfreeLinkId = link.linkId;
    purchase.cashfreeLinkStatus = link.status;
    purchase.paymentUrl = link.linkUrl;
    await purchase.save();

    return res.status(200).json({
      success: true,
      paymentUrl: link.linkUrl,
      purchaseId: purchase._id,
    });
  } catch (err) {
    console.error('initiateUpgrade error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, error: 'Failed to create upgrade payment.' });
  }
};

/**
 * Activates Pro subscription after confirmed payment.
 * Called internally from paymentController on success.
 */
export const activateSubscription = async (purchaseId, userId) => {
  try {
    if (!userId) return;

    const purchase = await Purchase.findById(purchaseId);
    if (!purchase || purchase.status !== 'paid') return;

    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1 year from now

    await Subscription.findOneAndUpdate(
      { userId },
      {
        plan: 'pro',
        status: 'active',
        expiresAt,
        purchaseId: purchase._id,
      },
      { upsert: true, new: true }
    );

    console.log(`[Subscription] Pro activated for userId=${userId}, expires=${expiresAt.toISOString()}`);
  } catch (err) {
    console.error('activateSubscription error:', err);
  }
};
