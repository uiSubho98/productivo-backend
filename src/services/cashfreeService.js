import axios from 'axios';
import crypto from 'crypto';
import env from '../config/env.js';

function requireConfig() {
  if (!env.cashfreeAppId || !env.cashfreeSecretKey) {
    throw new Error('Cashfree not configured. Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY.');
  }
}

function headers() {
  return {
    'x-api-version': env.cashfreeApiVersion,
    'x-client-id': env.cashfreeAppId,
    'x-client-secret': env.cashfreeSecretKey,
    'Content-Type': 'application/json',
  };
}

// Normalize to a Cashfree-accepted format.
// Accepts: 10 bare digits, OR 12 digits starting with "91" (drops the prefix).
// Rejects everything else with a clear message — never silently truncate.
function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) throw new Error('Phone number is required.');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  throw new Error(
    `Phone must be 10 digits (or +91 followed by 10 digits). You entered ${digits.length} digits.`
  );
}

/**
 * Create a hosted Payment Link.
 * Returns { linkId, linkUrl, status, raw }.
 */
export async function createPaymentLink({
  linkId,
  amount,
  purpose,
  customerName,
  customerEmail,
  customerPhone,
  returnUrl,
  notifyUrl,
}) {
  requireConfig();

  const body = {
    link_id: linkId,
    link_amount: amount,
    link_currency: 'INR',
    link_purpose: purpose,
    customer_details: {
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: normalizePhone(customerPhone),
    },
    link_notify: { send_sms: false, send_email: false },
    link_meta: {
      return_url: returnUrl,
      notify_url: notifyUrl,
    },
    link_auto_reminders: false,
  };

  const { data } = await axios.post(`${env.cashfreeBaseUrl}/links`, body, {
    headers: headers(),
    timeout: 15000,
  });

  return {
    linkId: data.link_id,
    linkUrl: data.link_url,
    status: data.link_status,
    raw: data,
  };
}

/**
 * Fetch the current state of a Payment Link (status + linked orders).
 */
export async function getPaymentLink(linkId) {
  requireConfig();
  const { data } = await axios.get(`${env.cashfreeBaseUrl}/links/${encodeURIComponent(linkId)}`, {
    headers: headers(),
    timeout: 15000,
  });
  return data;
}

/**
 * Fetch orders associated with a Payment Link to grab the order_id + payment_id.
 */
export async function getPaymentLinkOrders(linkId) {
  requireConfig();
  const { data } = await axios.get(`${env.cashfreeBaseUrl}/links/${encodeURIComponent(linkId)}/orders`, {
    headers: headers(),
    timeout: 15000,
  });
  return Array.isArray(data) ? data : [];
}

/**
 * Verify a Cashfree webhook signature.
 * Signature = base64(HMAC-SHA256(secret, timestamp + rawBody))
 */
export function verifyWebhookSignature({ rawBody, timestamp, signature }) {
  if (!rawBody || !timestamp || !signature) return false;
  try {
    const payload = `${timestamp}${rawBody}`;
    const expected = crypto
      .createHmac('sha256', env.cashfreeSecretKey)
      .update(payload)
      .digest('base64');
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export default {
  createPaymentLink,
  getPaymentLink,
  getPaymentLinkOrders,
  verifyWebhookSignature,
};
