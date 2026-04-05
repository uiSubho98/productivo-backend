import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import validate from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import {
  login,
  setupBiometric,
  setupMpin,
  verifyMpin,
  getProfile,
  updateProfile,
  forgotPassword,
  verifyOtp,
  resetPassword,
} from '../controllers/authController.js';

const router = Router();

// Per-email rate limit for forgot-password: max 3 requests per 15 minutes
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => (req.body?.email || req.ip).toLowerCase().trim(),
  handler: (_req, res) =>
    res.status(429).json({
      success: false,
      error: 'Too many OTP requests for this email. Please wait 15 minutes before trying again.',
    }),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
});

// No signup — superadmin is seeded, members are added via org admin
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
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits').isNumeric(),
  ]),
  verifyOtp
);

router.post(
  '/reset-password',
  validate([
    body('email').isEmail().withMessage('Valid email required').normalizeEmail(),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits').isNumeric(),
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

export default router;
