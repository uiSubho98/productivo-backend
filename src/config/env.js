import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, '../../.env') });

const requiredVars = [
  'MONGODB_URI',
  'JWT_SECRET',
];

for (const varName of requiredVars) {
  if (!process.env[varName]) {
    console.error(`Missing required environment variable: ${varName}`);
    process.exit(1);
  }
}

const env = {
  port: parseInt(process.env.PORT, 10) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',

  mongodbUri: process.env.MONGODB_URI,

  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  gdriveRootFolderId: process.env.GDRIVE_ROOT_FOLDER_ID || '',

  smtpHost: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  smtpPort: parseInt(process.env.SMTP_PORT, 10) || 587,
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFromEmail: process.env.SMTP_FROM_EMAIL || 'noreply@app.com',
  smtpFromName: process.env.SMTP_FROM_NAME || 'Productivity App',

  messageCentralAuthToken: process.env.MESSAGE_CENTRAL_AUTH_TOKEN || '',
  messageCentralBaseUrl: process.env.MESSAGE_CENTRAL_BASE_URL || '',

  // WhatsApp Cloud API (Meta Business Platform) — legacy, kept for inbound conversations
  waAppId: process.env.WA_APP_ID || '',
  waAppSecret: process.env.WA_APP_SECRET || '',
  waPhoneNumberId: process.env.WA_PHONE_NUMBER_ID || '',
  waAccessToken: process.env.WA_ACCESS_TOKEN || '',
  waWebhookVerifyToken: process.env.WA_WEBHOOK_VERIFY_TOKEN || 'whatsapp_webhook_secret',
  waApiVersion: process.env.WA_API_VERSION || 'v19.0',
  waDailyLimit: parseInt(process.env.WA_DAILY_LIMIT, 10) || 250,

  // WABridge (outbound template sends — invoice / task / meeting addons)
  wabridgeAppKey: process.env.WABRIDGE_APP_KEY || '',
  wabridgeAuthKey: process.env.WABRIDGE_AUTH_KEY || '',
  wabridgeDeviceId: process.env.WABRIDGE_DEVICE_ID || '',
  wabridgeBaseUrl: process.env.WABRIDGE_BASE_URL || 'https://web.wabridge.com/api',
  wabridgeTemplateInvoice: process.env.WABRIDGE_TEMPLATE_INVOICE || '831092433353192',
  wabridgeTemplateTaskReminder: process.env.WABRIDGE_TEMPLATE_TASK_REMINDER || '',
  wabridgeTemplateMeetingInvite: process.env.WABRIDGE_TEMPLATE_MEETING_INVITE || '',

  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',

  maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 10,

  // Public origin for webhooks / WhatsApp media URLs that external services fetch.
  // Must be reachable from the public internet (not localhost) in production.
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'https://www.productivo.in',

  // Cashfree Payment Gateway
  cashfreeAppId: process.env.CASHFREE_APP_ID || '',
  cashfreeSecretKey: process.env.CASHFREE_SECRET_KEY || '',
  cashfreeBaseUrl: process.env.CASHFREE_BASE_URL || 'https://sandbox.cashfree.com/pg',
  cashfreeApiVersion: process.env.CASHFREE_API_VERSION || '2022-09-01',
};

export default env;
