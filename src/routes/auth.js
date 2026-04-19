import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import validate from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { getGoogleAuthClient } from '../config/googleAuth.js';
import env from '../config/env.js';
import {
  setPhone,
  requestPhoneChange,
  updatePhone,
  listPendingRequests,
  approvePhoneChange,
  rejectPhoneChange,
} from '../controllers/phoneController.js';
import {
  register,
  login,
  setupBiometric,
  setupMpin,
  verifyMpin,
  getProfile,
  updateProfile,
  forgotPassword,
  verifyOtp,
  resetPassword,
  signupRequestOtp,
  signupVerifyOtp,
  deleteOwnAccount,
} from '../controllers/authController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TOKEN_PATH = resolve(__dirname, '../../.google-tokens.json');
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.file',
];

const router = Router();

// Per-email rate limit for forgot-password: max 3 requests per 15 minutes.
// Uses the library's IPv6-safe ipKeyGenerator as a fallback when no email is supplied.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyGenerator: (req, res) => {
    const email = (req.body?.email || '').toString().trim().toLowerCase();
    return email || ipKeyGenerator(req, res);
  },
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: 'Too many OTP requests for this email. Please wait 15 minutes before trying again.',
    }),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// Email-only signup — step 1: send OTP
router.post(
  '/signup/request-otp',
  forgotPasswordLimiter, // re-use same 3/15min rate limit
  validate([body('email').isEmail().withMessage('Valid email is required').normalizeEmail()]),
  signupRequestOtp
);

// Email-only signup — step 2: verify OTP → create account + issue JWT
router.post(
  '/signup/verify-otp',
  validate([
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits').isNumeric(),
  ]),
  signupVerifyOtp
);

// Legacy public signup — creates free superadmin + org + subscription
router.post(
  '/register',
  validate([
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('orgName').trim().notEmpty().withMessage('Organisation name is required').isLength({ max: 200 }),
  ]),
  register
);

router.post(
  '/login',
  validate([
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').notEmpty().withMessage('Password is required'),
  ]),
  login
);

router.put(
  '/biometric',
  authenticate,
  validate([
    body('biometricEnabled').isBoolean().withMessage('biometricEnabled must be boolean'),
  ]),
  setupBiometric
);

router.post(
  '/mpin/setup',
  authenticate,
  validate([
    body('mpin')
      .isLength({ min: 4, max: 4 })
      .withMessage('MPIN must be exactly 4 digits')
      .isNumeric()
      .withMessage('MPIN must contain only digits'),
  ]),
  setupMpin
);

router.post(
  '/mpin/verify',
  authenticate,
  validate([
    body('mpin').notEmpty().withMessage('MPIN is required'),
  ]),
  verifyMpin
);

// Forgot password flow (public — no auth)
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  validate([body('email').isEmail().withMessage('Valid email required').normalizeEmail()]),
  forgotPassword
);

router.post(
  '/verify-otp',
  validate([
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('otp').isLength({ min: 4, max: 4 }).withMessage('OTP must be 4 digits').isNumeric(),
  ]),
  verifyOtp
);

router.post(
  '/reset-password',
  validate([
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('otp').isLength({ min: 4, max: 4 }).withMessage('OTP must be 4 digits').isNumeric(),
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  ]),
  resetPassword
);

router.get('/profile', authenticate, getProfile);

router.put(
  '/profile',
  authenticate,
  validate([
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
  ]),
  updateProfile
);

router.delete('/account', authenticate, deleteOwnAccount);

// Profile phone — one-time set, request-change, update during 24h approval window
router.post('/profile/phone', authenticate, setPhone);
router.patch('/profile/phone', authenticate, updatePhone);
router.post('/profile/phone/request-change', authenticate, requestPhoneChange);

// Superadmin review of phone change requests
router.get('/phone-change-requests', authenticate, listPendingRequests);
router.post('/phone-change-requests/:id/approve', authenticate, approvePhoneChange);
router.post('/phone-change-requests/:id/reject', authenticate, rejectPhoneChange);

// Kick off Google OAuth flow — visit this URL in a browser to (re)authorize
router.get('/google', (_req, res) => {
  const client = getGoogleAuthClient();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GOOGLE_SCOPES,
    redirect_uri: env.googleRedirectUri,
  });
  res.redirect(url);
});

// OAuth callback — exchanges the authorization code for tokens and persists them
router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.status(400).send(`Google auth error: ${error}`);
  if (!code) return res.status(400).send('Missing authorization code');

  try {
    const client = getGoogleAuthClient();
    const { tokens } = await client.getToken({
      code,
      redirect_uri: env.googleRedirectUri,
    });

    if (!tokens.refresh_token) {
      return res
        .status(400)
        .send(
          'No refresh token returned. Revoke the app at https://myaccount.google.com/permissions and retry.'
        );
    }

    client.setCredentials(tokens);
    writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('[Google Auth] New tokens saved to .google-tokens.json');

    res.send('Google authorization successful. You can close this tab.');
  } catch (err) {
    console.error('[Google Auth] Callback failed:', err.message);
    res.status(500).send(`Authorization failed: ${err.message}`);
  }
});

export default router;
