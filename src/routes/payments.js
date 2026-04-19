import express from 'express';
import {
  initiatePayment,
  paymentWebhook,
  verifyPayment,
  confirmPayment,
  getPurchases,
  initiateAddonPayment,
} from '../controllers/paymentController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/initiate', initiatePayment);      // public — create payment request (for when account is approved)
router.post('/confirm', confirmPayment);         // public — called from frontend onSuccess callback
router.post('/webhook', paymentWebhook);         // public — Cashfree webhook
router.get('/verify', verifyPayment);            // public — verify after redirect
router.post('/addon/initiate', authenticate, initiateAddonPayment); // authed — WA addon checkout
router.get('/', authenticate, getPurchases);     // admin only

export default router;
