import axios from 'axios';
import Purchase from '../models/Purchase.js';
import { sendEmail } from '../services/emailService.js';
import { activateSubscription } from './subscriptionController.js';

const INSTAMOJO_API = 'https://test.instamojo.com/api/1.1';
const PRIVATE_KEY   = 'be67949eae1c1694cec1dc4778e17321';
const AUTH_TOKEN    = '6259e4a4fdf6b9fe1c358aa1a97ee748';

const instamojoHeaders = {
  'X-Api-Key':      PRIVATE_KEY,
  'X-Auth-Token':   AUTH_TOKEN,
  'Content-Type':   'application/x-www-form-urlencoded',
};

// Helper: build URL-encoded body
function encodeForm(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

// POST /api/v1/payments/initiate
export const initiatePayment = async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ success: false, error: 'Name, email and phone are required.' });
    }

    // Create purchase record
    const purchase = await Purchase.create({ name, email, phone, status: 'pending', type: 'new_lead' });

    // Build redirect & webhook URLs
    const baseUrl = req.headers.origin || 'https://www.productivo.in';
    const redirectUrl = `${baseUrl}/payment-success?pid=${purchase._id}`;
    const webhookUrl  = `https://www.productivo.in/api/v1/payments/webhook`;

    // Create Instamojo payment request
    const formData = encodeForm({
      purpose:      'Productivo Pro Plan - 1 Year',
      amount:       '1499',
      buyer_name:   name,
      email:        email,
      phone:        phone,
      redirect_url: redirectUrl,
      webhook:      webhookUrl,
      allow_repeated_payments: 'False',
      send_email:   'False',
      send_sms:     'False',
    });

    const instaRes = await axios.post(`${INSTAMOJO_API}/payment-requests/`, formData, {
      headers: instamojoHeaders,
    });

    const paymentRequest = instaRes.data.payment_request;
    await Purchase.findByIdAndUpdate(purchase._id, {
      paymentRequestId: paymentRequest.id,
      paymentUrl:       paymentRequest.longurl,
    });

    return res.status(200).json({
      success:    true,
      paymentUrl: paymentRequest.longurl,
      purchaseId: purchase._id,
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('initiatePayment error:', JSON.stringify(detail, null, 2));
    return res.status(500).json({ success: false, error: 'Failed to create payment request.', detail });
  }
};

// POST /api/v1/payments/webhook  — called by Instamojo after payment
export const paymentWebhook = async (req, res) => {
  try {
    const {
      payment_id,
      payment_request_id,
      status,
      buyer_name,
      buyer_email,
      buyer_phone,
      amount,
    } = req.body;

    const purchase = await Purchase.findOne({ paymentRequestId: payment_request_id });
    if (!purchase) return res.status(200).send('OK'); // unknown, ignore

    purchase.paymentId       = payment_id || '';
    purchase.instamojoStatus = status || '';
    purchase.status          = status === 'Credit' ? 'paid' : 'failed';
    await purchase.save();

    if (purchase.status === 'paid') {
      // Activate subscription (non-blocking)
      activateSubscription(purchase._id, purchase.userId).catch(() => {});

      if (!purchase.invoiceEmailSent) {
        await sendInvoiceEmail(purchase);
        purchase.invoiceEmailSent = true;
        await purchase.save();
      }
    }

    return res.status(200).send('OK');
  } catch (err) {
    console.error('paymentWebhook error:', err.message);
    return res.status(200).send('OK'); // always 200 to Instamojo
  }
};

// GET /api/v1/payments/verify?pid=<purchaseId>&payment_id=<pid>&payment_request_id=<prid>
// Called from frontend redirect after payment
export const verifyPayment = async (req, res) => {
  try {
    const { pid, payment_id, payment_request_id } = req.query;

    let purchase = await Purchase.findById(pid);
    if (!purchase) return res.status(404).json({ success: false, error: 'Purchase not found.' });

    // If already marked paid (webhook was faster), return immediately
    if (purchase.status === 'paid') {
      return res.status(200).json({ success: true, status: 'paid', purchase });
    }

    // Otherwise query Instamojo directly
    if (payment_request_id && payment_id) {
      const instaRes = await axios.get(
        `${INSTAMOJO_API}/payment-requests/${payment_request_id}/${payment_id}/`,
        { headers: instamojoHeaders }
      );

      const p = instaRes.data.payment_request?.payments?.[0];
      if (p) {
        purchase.paymentId       = payment_id;
        purchase.instamojoStatus = p.status;
        purchase.status          = p.status === 'Credit' ? 'paid' : 'failed';
        await purchase.save();
      }
    }

    if (purchase.status === 'paid') {
      activateSubscription(purchase._id, purchase.userId).catch(() => {});
      if (!purchase.invoiceEmailSent) {
        await sendInvoiceEmail(purchase);
        purchase.invoiceEmailSent = true;
        await purchase.save();
      }
    }

    return res.status(200).json({ success: true, status: purchase.status, purchase });
  } catch (err) {
    console.error('verifyPayment error:', err.response?.data || err.message);
    return res.status(500).json({ success: false, error: 'Verification failed.' });
  }
};

// POST /api/v1/payments/confirm — called from frontend after Instamojo onSuccess
export const confirmPayment = async (req, res) => {
  try {
    const { name, email, phone, paymentId } = req.body;
    if (!name || !email || !phone) {
      return res.status(400).json({ success: false, error: 'Missing required fields.' });
    }

    const purchase = await Purchase.create({
      name, email, phone,
      paymentId: paymentId || '',
      status: 'paid',
      type: 'new_lead',
      instamojoStatus: 'Credit',
    });

    // Activate subscription if userId provided (in-app upgrade)
    if (req.user?.role === 'superadmin') {
      activateSubscription(purchase._id, req.user._id).catch(() => {});
    }

    await sendInvoiceEmail(purchase);
    await Purchase.findByIdAndUpdate(purchase._id, { invoiceEmailSent: true });

    return res.status(201).json({ success: true, purchaseId: purchase._id });
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
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Failed to fetch purchases.' });
  }
};

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
      <div class="invoice-row">
        <span class="invoice-label">Invoice No.</span>
        <span class="invoice-value">${invoiceNo}</span>
      </div>
      <div class="invoice-row">
        <span class="invoice-label">Date</span>
        <span class="invoice-value">${date}</span>
      </div>
      <div class="invoice-row">
        <span class="invoice-label">Name</span>
        <span class="invoice-value">${purchase.name}</span>
      </div>
      <div class="invoice-row">
        <span class="invoice-label">Email</span>
        <span class="invoice-value">${purchase.email}</span>
      </div>
      <div class="invoice-row">
        <span class="invoice-label">Plan</span>
        <span class="invoice-value">Productivo Pro — 1 Year</span>
      </div>
      <div class="invoice-row">
        <span class="invoice-label">Billing Period</span>
        <span class="invoice-value">Annual</span>
      </div>
      <div class="invoice-row total">
        <span>Total Paid</span>
        <span>₹1,499</span>
      </div>
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

    <div class="cta">
      <a href="https://crm.productivo.in">Open Your Dashboard →</a>
    </div>

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
