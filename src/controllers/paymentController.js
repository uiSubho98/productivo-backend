import bcrypt from 'bcryptjs';
import Purchase from '../models/Purchase.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import WhatsappAddon, { ADDON_FEATURES, ADDON_PRICES } from '../models/WhatsappAddon.js';
import { sendEmail } from '../services/emailService.js';
import * as cashfree from '../services/cashfreeService.js';
import { activateSubscription } from './subscriptionController.js';

const PRO_AMOUNT = 1499;
const WEBHOOK_URL = 'https://www.productivo.in/api/v1/payments/webhook';

function buildLinkId(prefix, purchaseId) {
  return `${prefix}_${purchaseId}_${Date.now().toString(36)}`;
}

// POST /api/v1/payments/initiate — landing page Pro plan upgrade
export const initiatePayment = async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ success: false, error: 'Name, email and phone are required.' });
    }

    const purchase = await Purchase.create({
      name,
      email,
      phone,
      amount: PRO_AMOUNT,
      status: 'pending',
      type: 'new_lead',
    });

    const baseUrl = req.headers.origin || 'https://www.productivo.in';
    const returnUrl = `${baseUrl}/payment-success?pid=${purchase._id}`;
    const linkId = buildLinkId('pro', purchase._id);

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
    const detail = err.response?.data || err.message;
    console.error('initiatePayment error:', JSON.stringify(detail, null, 2));
    const gatewayMsg = err.response?.data?.message || err.message;
    return res.status(400).json({
      success: false,
      error: gatewayMsg || 'Failed to create payment request.',
    });
  }
};

// POST /api/v1/payments/addon/initiate — superadmin-only WhatsApp addon purchase
// Phone auto-populated from user.phoneNumber (must be set in Settings → Profile first)
export const initiateAddonPayment = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
    if (user.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        error: 'Only the superadmin can purchase WhatsApp add-ons.',
      });
    }
    const phone = (user.phoneNumber || '').toString().trim();
    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'Set your phone number in Settings → Profile before purchasing.',
      });
    }

    const rawFeatures = Array.isArray(req.body?.features) ? req.body.features : [];
    const features = [...new Set(rawFeatures)].filter((f) => ADDON_FEATURES.includes(f));
    if (!features.length) {
      return res.status(400).json({
        success: false,
        error: `features must be a non-empty subset of [${ADDON_FEATURES.join(', ')}]`,
      });
    }

    const isBundle = features.length === ADDON_FEATURES.length;
    const amount = isBundle ? ADDON_PRICES.bundle : features.length * ADDON_PRICES.invoice;
    const purpose = isBundle
      ? 'Productivo WhatsApp Add-ons — All 3 (1 Year)'
      : `Productivo WhatsApp Add-on — ${features.join(', ')} (1 Year)`;

    const purchase = await Purchase.create({
      name: user.name,
      email: user.email,
      phone,
      plan: 'WhatsApp Addon',
      amount,
      type: 'whatsapp_addon',
      addonFeatures: features,
      addonBundle: isBundle,
      userId: user._id,
      status: 'pending',
    });

    const baseUrl = req.headers.origin || 'https://crm.productivo.in';
    const returnUrl = `${baseUrl}/premium?pid=${purchase._id}&addon=1`;
    const linkId = buildLinkId('addon', purchase._id);

    const link = await cashfree.createPaymentLink({
      linkId,
      amount,
      purpose,
      customerName: user.name,
      customerEmail: user.email,
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
      amount,
      features,
      isBundle,
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('initiateAddonPayment error:', JSON.stringify(detail, null, 2));
    const gatewayMsg = err.response?.data?.message || err.message;
    return res.status(400).json({
      success: false,
      error: gatewayMsg || 'Failed to create payment request.',
    });
  }
};

// POST /api/v1/payments/webhook — Cashfree webhook
// Signature: HMAC-SHA256(secret, timestamp + rawBody) base64-encoded
export const paymentWebhook = async (req, res) => {
  try {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const rawBody = req.rawBody || JSON.stringify(req.body);

    const valid = cashfree.verifyWebhookSignature({ rawBody, timestamp, signature });
    if (!valid) {
      console.warn('[Cashfree webhook] signature verification failed');
      return res.status(401).send('invalid signature');
    }

    const event = req.body || {};
    const data = event?.data || {};
    const type = event?.type || '';

    // Two relevant payloads:
    //  1) PAYMENT_LINK_EVENT   — data.link_id + data.link_status=PAID
    //  2) PAYMENT_SUCCESS_WEBHOOK / PAYMENT_FAILED_WEBHOOK — nested order/payment
    let linkId = data.link_id || data?.order?.order_tags?.link_id || '';
    if (!linkId && data?.order?.order_id) {
      // Some webhooks include the link_id in order_tags only when linked to a link
      linkId = data.order.order_tags?.link_id || '';
    }

    if (!linkId) {
      // Fallback: treat by order_id — not relevant for our flow (we only use links)
      return res.status(200).send('OK');
    }

    const purchase = await Purchase.findOne({ cashfreeLinkId: linkId });
    if (!purchase) return res.status(200).send('OK'); // unknown link

    // Derive paid/failed from whichever shape we got
    const linkStatus = data.link_status || '';
    const paymentStatus = data?.payment?.payment_status || ''; // SUCCESS / FAILED / USER_DROPPED / etc.

    const isPaid =
      linkStatus === 'PAID' ||
      paymentStatus === 'SUCCESS' ||
      type === 'PAYMENT_SUCCESS_WEBHOOK';

    const isFailed =
      linkStatus === 'EXPIRED' ||
      linkStatus === 'CANCELLED' ||
      paymentStatus === 'FAILED' ||
      type === 'PAYMENT_FAILED_WEBHOOK';

    if (linkStatus) purchase.cashfreeLinkStatus = linkStatus;
    if (data?.order?.order_id) purchase.cashfreeOrderId = data.order.order_id;
    if (data?.payment?.cf_payment_id) purchase.cashfreePaymentId = String(data.payment.cf_payment_id);

    if (isPaid) purchase.status = 'paid';
    else if (isFailed) purchase.status = 'failed';
    await purchase.save();

    if (purchase.status === 'paid') {
      if (purchase.type === 'whatsapp_addon') {
        await activateAddonPurchase(purchase).catch((e) =>
          console.error('activateAddonPurchase webhook error:', e.message)
        );
      } else {
        const userId = await provisionAccountForPurchase(purchase).catch((e) => {
          console.error('provisionAccountForPurchase webhook error:', e.message);
          return purchase.userId;
        });
        activateSubscription(purchase._id, userId).catch(() => {});
        if (!purchase.invoiceEmailSent) {
          await sendInvoiceEmail(purchase);
          purchase.invoiceEmailSent = true;
          await purchase.save();
        }
      }
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('paymentWebhook error:', err.message);
    return res.status(200).send('OK'); // always 200 so Cashfree stops retrying on bugs in our code
  }
};

// GET /api/v1/payments/verify?pid=<purchaseId>
// Called from frontend on return URL. Verifies status by hitting Cashfree directly.
export const verifyPayment = async (req, res) => {
  try {
    const { pid } = req.query;
    const purchase = await Purchase.findById(pid);
    if (!purchase) return res.status(404).json({ success: false, error: 'Purchase not found.' });

    if (purchase.status === 'paid') {
      return res.status(200).json({ success: true, status: 'paid', purchase });
    }

    if (purchase.cashfreeLinkId) {
      try {
        const link = await cashfree.getPaymentLink(purchase.cashfreeLinkId);
        purchase.cashfreeLinkStatus = link.link_status || purchase.cashfreeLinkStatus;
        if (link.link_status === 'PAID') {
          purchase.status = 'paid';
          const orders = await cashfree.getPaymentLinkOrders(purchase.cashfreeLinkId).catch(() => []);
          if (orders?.[0]?.order_id) purchase.cashfreeOrderId = orders[0].order_id;
        } else if (link.link_status === 'EXPIRED' || link.link_status === 'CANCELLED') {
          purchase.status = 'failed';
        }
        await purchase.save();
      } catch (e) {
        console.error('verifyPayment cashfree fetch failed:', e.response?.data || e.message);
      }
    }

    if (purchase.status === 'paid') {
      if (purchase.type === 'whatsapp_addon') {
        await activateAddonPurchase(purchase).catch((e) =>
          console.error('activateAddonPurchase verify error:', e.message)
        );
      } else {
        const userId = await provisionAccountForPurchase(purchase).catch((e) => {
          console.error('provisionAccountForPurchase verify error:', e.message);
          return purchase.userId;
        });
        activateSubscription(purchase._id, userId).catch(() => {});
        if (!purchase.invoiceEmailSent) {
          await sendInvoiceEmail(purchase);
          purchase.invoiceEmailSent = true;
          await purchase.save();
        }
      }
    }

    return res.status(200).json({ success: true, status: purchase.status, purchase });
  } catch (err) {
    console.error('verifyPayment error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, error: 'Verification failed.' });
  }
};

// POST /api/v1/payments/confirm — retained for backwards compat with any client
// that already POSTs a "paid" confirmation. Cashfree's reliable webhook + verify
// endpoint make this effectively a no-op — we just ensure a Purchase row exists.
export const confirmPayment = async (req, res) => {
  try {
    const { name, email, phone, purchaseId } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }

    let purchase = null;
    if (purchaseId) purchase = await Purchase.findById(purchaseId);

    if (!purchase) {
      purchase = await Purchase.create({
        name,
        email,
        phone,
        amount: PRO_AMOUNT,
        status: 'pending',
        type: 'new_lead',
      });
    }

    return res.status(200).json({ success: true, purchaseId: purchase._id });
  } catch (err) {
    console.error('confirmPayment error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to confirm purchase.' });
  }
};

// GET /api/v1/payments — admin only, list all purchases
export const getPurchases = async (req, res) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter = status ? { status } : {};
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [purchases, total] = await Promise.all([
      Purchase.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Purchase.countDocuments(filter),
    ]);
    return res.status(200).json({ success: true, data: purchases, total });
  } catch {
    return res.status(500).json({ success: false, error: 'Failed to fetch purchases.' });
  }
};

// Internal: ensure a superadmin User + master Org exist for a paid landing-page
// (`new_lead`) purchase. Password is set to the email (per product decision).
// Idempotent — safe to call on webhook + verify races.
async function provisionAccountForPurchase(purchase) {
  if (purchase.userId) return purchase.userId;

  const email = purchase.email.toLowerCase().trim();
  let user = await User.findOne({ email });

  if (!user) {
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(email, salt);
    user = await User.create({
      name: purchase.name.trim(),
      email,
      passwordHash,
      role: 'superadmin',
    });
  } else if (user.role !== 'superadmin' && user.role !== 'product_owner') {
    user.role = 'superadmin';
    await user.save();
  }

  let org = await Organization.findOne({ superadminId: user._id, parentOrgId: null });
  if (!org) {
    org = await Organization.create({
      name: `${purchase.name.trim()}'s Workspace`,
      adminIds: [user._id],
      superadminId: user._id,
      parentOrgId: null,
    });
  }

  if (!user.organizationId) {
    user.organizationId = org._id;
    await user.save();
  }

  purchase.userId = user._id;
  await purchase.save();

  return user._id;
}

// Internal: activate WA addon features once Purchase.status === 'paid'
async function activateAddonPurchase(purchase) {
  if (purchase.addonActivated) return;
  if (!purchase.userId) return;
  const features = purchase.addonFeatures?.length ? purchase.addonFeatures : [];
  if (!features.length) return;

  let record = await WhatsappAddon.findOne({ superadminId: purchase.userId });
  if (!record) {
    record = await WhatsappAddon.create({ superadminId: purchase.userId, addons: [] });
  }
  record.activateFeatures(features, { purchaseId: purchase._id, durationDays: 365 });
  await record.save();

  purchase.addonActivated = true;
  await purchase.save();
}

// ─── Internal: send invoice email via Brevo ─────────────────────────────────
async function sendInvoiceEmail(purchase) {
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const invoiceNo = `PRO-${Date.now().toString().slice(-8)}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>
    body { margin:0; padding:0; background:#f4f4f7; font-family:'Helvetica Neue',Helvetica,Arial,sans-serif; }
    .wrapper { max-width:560px; margin:40px auto; background:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 2px 16px rgba(0,0,0,0.08); }
    .header { background:linear-gradient(135deg,#6366F1,#7C3AED); padding:40px 40px 32px; text-align:center; }
    .header h1 { margin:0; color:#fff; font-size:28px; font-weight:800; letter-spacing:-0.5px; }
    .header p  { margin:8px 0 0; color:rgba(255,255,255,0.8); font-size:14px; }
    .body { padding:36px 40px; }
    .greeting { font-size:16px; color:#1f2937; margin-bottom:24px; }
    .invoice-box { background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; padding:24px; margin-bottom:24px; }
    .invoice-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f0f0f0; }
    .invoice-row:last-child { border-bottom:none; padding-top:14px; margin-top:6px; }
    .invoice-row.total { border-top:2px solid #e5e7eb; font-weight:700; font-size:17px; color:#111827; }
    .invoice-label { color:#6b7280; font-size:14px; }
    .invoice-value { color:#111827; font-size:14px; font-weight:500; }
    .badge { display:inline-block; background:#d1fae5; color:#065f46; padding:4px 12px; border-radius:999px; font-size:12px; font-weight:700; margin-bottom:20px; }
    .features { margin:0 0 28px; padding:0; list-style:none; }
    .features li { padding:7px 0; color:#374151; font-size:14px; }
    .features li::before { content:'✓ '; color:#6366F1; font-weight:700; }
    .cta { text-align:center; margin:28px 0; }
    .cta a { display:inline-block; background:linear-gradient(135deg,#6366F1,#7C3AED); color:#fff; text-decoration:none; padding:14px 36px; border-radius:8px; font-size:15px; font-weight:700; }
    .footer { background:#f9fafb; padding:24px 40px; text-align:center; font-size:12px; color:#9ca3af; border-top:1px solid #e5e7eb; }
    .footer a { color:#6366F1; text-decoration:none; }
  </style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>Productivo</h1>
    <p>Payment Confirmed — Your Pro Plan is Active</p>
  </div>
  <div class="body">
    <p class="greeting">Hi ${purchase.name},<br><br>Thank you for subscribing to <strong>Productivo Pro</strong>! Your payment has been received and your account is now active.</p>

    <div class="badge">✓ Payment Successful</div>

    <div class="invoice-box">
      <div class="invoice-row"><span class="invoice-label">Invoice No.</span><span class="invoice-value">${invoiceNo}</span></div>
      <div class="invoice-row"><span class="invoice-label">Date</span><span class="invoice-value">${date}</span></div>
      <div class="invoice-row"><span class="invoice-label">Name</span><span class="invoice-value">${purchase.name}</span></div>
      <div class="invoice-row"><span class="invoice-label">Email</span><span class="invoice-value">${purchase.email}</span></div>
      <div class="invoice-row"><span class="invoice-label">Plan</span><span class="invoice-value">Productivo Pro — 1 Year</span></div>
      <div class="invoice-row"><span class="invoice-label">Billing Period</span><span class="invoice-value">Annual</span></div>
      <div class="invoice-row total"><span>Total Paid</span><span>₹${purchase.amount?.toLocaleString?.('en-IN') || PRO_AMOUNT}</span></div>
    </div>

    <div class="invoice-box" style="background:#eef2ff;border-color:#c7d2fe;">
      <p style="margin:0 0 10px;font-size:14px;color:#3730a3;font-weight:700;">Your login credentials</p>
      <div class="invoice-row"><span class="invoice-label">Email</span><span class="invoice-value">${purchase.email}</span></div>
      <div class="invoice-row"><span class="invoice-label">Password</span><span class="invoice-value">${purchase.email}</span></div>
      <p style="margin:12px 0 0;font-size:12px;color:#4338ca;">For security, please change your password after first login from Settings → Profile.</p>
    </div>

    <p style="font-size:14px;color:#374151;margin-bottom:16px;"><strong>What's included in your Pro plan:</strong></p>
    <ul class="features">
      <li>Unlimited clients &amp; projects</li>
      <li>GST-ready invoices with PDF export</li>
      <li>WhatsApp CRM integration</li>
      <li>Google Meet integration</li>
      <li>Full activity logs</li>
      <li>Mobile app access</li>
      <li>Priority support</li>
    </ul>

    <div class="cta"><a href="https://crm.productivo.in">Open Your Dashboard →</a></div>

    <p style="font-size:13px;color:#6b7280;text-align:center;">Need help getting started? Reply to this email or WhatsApp us at <strong>+91-94772-32082</strong></p>
  </div>
  <div class="footer">
    &copy; 2026 Productivo · <a href="https://www.productivo.in">productivo.in</a><br>
    Bengaluru, India · <a href="mailto:dsubhojit962@gmail.com">dsubhojit962@gmail.com</a>
  </div>
</div>
</body>
</html>`;

  await sendEmail(
    purchase.email,
    `Payment Confirmed — Productivo Pro (Invoice ${invoiceNo})`,
    html
  );
}
