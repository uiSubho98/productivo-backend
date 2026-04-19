import axios from 'axios';
import env from '../config/env.js';

const TEMPLATE_ENDPOINT = 'createmessage';
const TEXT_ENDPOINT = 'createtextmessage';

function requireConfig() {
  if (!env.wabridgeAppKey || !env.wabridgeAuthKey || !env.wabridgeDeviceId) {
    throw new Error(
      'WABridge not configured. Set WABRIDGE_APP_KEY, WABRIDGE_AUTH_KEY, WABRIDGE_DEVICE_ID.'
    );
  }
}

function normalizeNumber(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 10 ? `91${digits}` : digits;
}

export async function sendTemplate({ to, templateId, variables = [], buttonVariable = [], media = '' }) {
  requireConfig();
  if (!templateId) throw new Error('templateId is required');
  const destination = normalizeNumber(to);
  if (!destination) throw new Error('Invalid destination number');

  const payload = {
    'app-key': env.wabridgeAppKey,
    'auth-key': env.wabridgeAuthKey,
    destination_number: destination,
    device_id: env.wabridgeDeviceId,
    template_id: templateId,
    variables,
    button_variable: buttonVariable,
    media,
    message: '',
  };

  const { data } = await axios.post(`${env.wabridgeBaseUrl}/${TEMPLATE_ENDPOINT}`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  if (!data?.status) {
    throw new Error(data?.message || 'WABridge template send failed');
  }

  return { messageId: data?.data?.messageid || '', raw: data };
}

export async function sendText({ to, message, mediaLink = '', mediaType = '' }) {
  requireConfig();
  if (!message) throw new Error('message is required');
  const destination = normalizeNumber(to);
  if (!destination) throw new Error('Invalid destination number');

  const payload = {
    'app-key': env.wabridgeAppKey,
    'auth-key': env.wabridgeAuthKey,
    destination_number: destination,
    device_id: env.wabridgeDeviceId,
    message,
    media_link: mediaLink,
    media_type: mediaType,
  };

  const { data } = await axios.post(`${env.wabridgeBaseUrl}/${TEXT_ENDPOINT}`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000,
  });

  if (!data?.status) {
    throw new Error(data?.message || 'WABridge text send failed');
  }

  return { messageId: data?.data?.messageid || '', raw: data };
}

export default { sendTemplate, sendText };
