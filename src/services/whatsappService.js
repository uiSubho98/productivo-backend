/**
 * WhatsApp Cloud API Service (Meta Business Platform)
 * Replaces Message Central with the official WhatsApp Business Cloud API.
 *
 * Setup:
 *  1. Create a Meta Developer app at developers.facebook.com
 *  2. Add WhatsApp product, get a Phone Number ID
 *  3. Generate a long-lived access token (see exchangeToken below or use System User token)
 *  4. Set WA_PHONE_NUMBER_ID and WA_ACCESS_TOKEN in .env
 *  5. Register webhook URL: POST /api/v1/whatsapp/webhook with verify token = WA_WEBHOOK_VERIFY_TOKEN
 */

import axios from 'axios';
import env from '../config/env.js';
import ActivityLog from '../models/ActivityLog.js';

const WA_BASE = `https://graph.facebook.com/${env.waApiVersion}`;

function buildClient() {
  return axios.create({
    baseURL: WA_BASE,
    headers: {
      Authorization: `Bearer ${env.waAccessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
}

// Daily message rate-limit tracker (Tier-1 default: 250/day)
const _daily = { date: null, count: 0 };

function checkDailyLimit() {
  const today = new Date().toDateString();
  if (_daily.date !== today) {
    _daily.date = today;
    _daily.count = 0;
  }
  const limit = env.waDailyLimit || 250;
  if (_daily.count >= limit) {
    throw new Error(`WhatsApp daily message limit of ${limit} reached. Resets at midnight.`);
  }
  _daily.count += 1;
}

/** Normalise a phone number to digits only (E.164 without the leading +) */
function cleanPhone(phone) {
  return String(phone).replace(/[^0-9]/g, '');
}

/**
 * Send a plain text message.
 * @param {string} phoneNumber - e.g. "+919876543210" or "919876543210"
 * @param {string} message
 */
export const sendMessage = async (phoneNumber, message) => {
  try {
    checkDailyLimit();
    const waClient = buildClient();
    const response = await waClient.post(`/${env.waPhoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone(phoneNumber),
      type: 'text',
      text: { preview_url: false, body: message },
    });
    console.log(`[WA] Text sent to ${phoneNumber} — id: ${response.data?.messages?.[0]?.id}`);
    ActivityLog.create({ type: 'whatsapp', to: phoneNumber, subject: message.substring(0, 100), success: true }).catch(() => {});
    return { success: true, data: response.data };
  } catch (error) {
    const errMsg = error.response?.data?.error?.message || error.message;
    console.error(`[WA] sendMessage error to ${phoneNumber}:`, errMsg);
    ActivityLog.create({ type: 'whatsapp', to: phoneNumber, subject: message.substring(0, 100), success: false, errorMsg: errMsg }).catch(() => {});
    return { success: false, error: errMsg };
  }
};

/**
 * Send a group text message (broadcast to array of phone numbers).
 * WhatsApp Cloud API is 1-to-1 only, so this loops over recipients.
 * @param {string[]} phoneNumbers
 * @param {string} message
 */
export const sendToGroup = async (phoneNumbers, message) => {
  const results = [];
  for (const phone of phoneNumbers) {
    const res = await sendMessage(phone, message);
    results.push({ phone, ...res });
  }
  return results;
};

/**
 * Send a document (PDF, etc.) via a public URL.
 * @param {string} phoneNumber
 * @param {string} documentUrl - must be publicly accessible
 * @param {string} caption
 * @param {string} filename
 */
export const sendDocument = async (phoneNumber, documentUrl, caption = '', filename = 'document.pdf') => {
  try {
    checkDailyLimit();
    const waClient = buildClient();
    const response = await waClient.post(`/${env.waPhoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanPhone(phoneNumber),
      type: 'document',
      document: {
        link: documentUrl,
        caption: caption.substring(0, 1024),
        filename,
      },
    });
    console.log(`[WA] Document sent to ${phoneNumber}`);
    ActivityLog.create({ type: 'whatsapp', to: phoneNumber, subject: `document: ${filename}`, success: true }).catch(() => {});
    return { success: true, data: response.data };
  } catch (error) {
    const errMsg = error.response?.data?.error?.message || error.message;
    console.error(`[WA] sendDocument error to ${phoneNumber}:`, errMsg);
    ActivityLog.create({ type: 'whatsapp', to: phoneNumber, subject: `document: ${filename}`, success: false, errorMsg: errMsg }).catch(() => {});
    return { success: false, error: errMsg };
  }
};

/**
 * Send a pre-approved template message (required for business-initiated conversations).
 * @param {string} phoneNumber
 * @param {string} templateName  - approved template name in Meta dashboard
 * @param {string} languageCode  - e.g. "en_US"
 * @param {Array}  components    - template variable components
 */
export const sendTemplate = async (phoneNumber, templateName, languageCode = 'en_US', components = []) => {
  try {
    checkDailyLimit();
    const waClient = buildClient();
    const response = await waClient.post(`/${env.waPhoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to: cleanPhone(phoneNumber),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    });
    console.log(`[WA] Template "${templateName}" sent to ${phoneNumber}`);
    return { success: true, data: response.data };
  } catch (error) {
    const errMsg = error.response?.data?.error?.message || error.message;
    console.error(`[WA] sendTemplate error to ${phoneNumber}:`, errMsg);
    return { success: false, error: errMsg };
  }
};

/**
 * Mark an incoming message as read (sends read receipt).
 * @param {string} waMessageId - the WhatsApp message ID from the webhook
 */
export const markMessageRead = async (waMessageId) => {
  try {
    const waClient = buildClient();
    await waClient.post(`/${env.waPhoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: waMessageId,
    });
    return { success: true };
  } catch (error) {
    // Non-critical — don't throw
    console.warn(`[WA] markMessageRead error:`, error.response?.data?.error?.message || error.message);
    return { success: false };
  }
};

/**
 * Exchange a short-lived user access token for a long-lived token (~60 days).
 * Use: GET https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token
 *         &client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={SHORT_LIVED}
 *
 * For production, use a System User permanent token instead.
 * @param {string} shortLivedToken
 */
export const exchangeToken = async (shortLivedToken) => {
  try {
    const response = await axios.get('https://graph.facebook.com/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: env.waAppId,
        client_secret: env.waAppSecret,
        fb_exchange_token: shortLivedToken,
      },
      timeout: 10000,
    });
    return { success: true, data: response.data };
  } catch (error) {
    const errMsg = error.response?.data?.error?.message || error.message;
    console.error('[WA] Token exchange error:', errMsg);
    return { success: false, error: errMsg };
  }
};

/** Current daily message count (for monitoring). */
export const getDailyCount = () => ({ ..._daily, limit: env.waDailyLimit || 250 });

export default { sendMessage, sendToGroup, sendDocument, sendTemplate, markMessageRead, exchangeToken, getDailyCount };
