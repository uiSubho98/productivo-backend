/**
 * Subscription controller.
 *
 * GET  /api/v1/subscription          — current user's plan status
 * POST /api/v1/subscription/upgrade  — initiate Instamojo payment for Pro upgrade
 * POST /api/v1/subscription/activate — called internally after payment confirmed
 */

import axios from 'axios';
import Subscription from '../models/Subscription.js';
import Purchase from '../models/Purchase.js';
import Organization from '../models/Organization.js';
import User from '../models/User.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import Invoice from '../models/Invoice.js';
import { PLANS } from '../models/Subscription.js';

const INSTAMOJO_API = 'https://test.instamojo.com/api/1.1';
const PRIVATE_KEY = 'be67949eae1c1694cec1dc4778e17321';
const AUTH_TOKEN = '6259e4a4fdf6b9fe1c358aa1a97ee748';

const instamojoHeaders = {
  'X-Api-Key': PRIVATE_KEY,
  'X-Auth-Token': AUTH_TOKEN,
  'Content-Type': 'application/x-www-form-urlencoded',
};

function encodeForm(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

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
 * Initiates an Instamojo payment for upgrading to Pro.
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
      amount: 1499,
      status: 'pending',
      type: 'upgrade',
      // store userId in a metadata field for activation
      userId: userId || undefined,
    });

    const baseUrl = req.headers.origin || 'https://www.productivo.in';
    const redirectUrl = `${baseUrl}/payment-success?pid=${purchase._id}&upgrade=1`;
    const webhookUrl = `https://www.productivo.in/api/v1/payments/webhook`;

    const formData = encodeForm({
      purpose: 'Productivo Pro Plan - 1 Year',
      amount: '1499',
      buyer_name: name,
      email,
      phone,
      redirect_url: redirectUrl,
      webhook: webhookUrl,
      allow_repeated_payments: 'False',
      send_email: 'False',
      send_sms: 'False',
    });

    const instaRes = await axios.post(`${INSTAMOJO_API}/payment-requests/`, formData, {
      headers: instamojoHeaders,
    });

    const paymentRequest = instaRes.data.payment_request;
    await Purchase.findByIdAndUpdate(purchase._id, {
      paymentRequestId: paymentRequest.id,
      paymentUrl: paymentRequest.longurl,
    });

    return res.status(200).json({
      success: true,
      paymentUrl: paymentRequest.longurl,
      purchaseId: purchase._id,
    });
  } catch (err) {
    console.error('initiateUpgrade error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, error: 'Failed to create upgrade payment.' });
  }
};

/**
 * POST /api/v1/subscription/activate
 * Activates Pro subscription after confirmed payment.
 * Called internally from paymentController on success.
 * Body: { purchaseId, userId }
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
