import express from 'express';
import { initiatePayment, paymentWebhook, verifyPayment, confirmPayment, getPurchases } from '../controllers/paymentController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/initiate', initiatePayment);      // public — create payment request (for when account is approved)
router.post('/confirm', confirmPayment);         // public — called from frontend onSuccess callback
router.post('/webhook', paymentWebhook);         // public — Instamojo webhook
router.get('/verify', verifyPayment);            // public — verify after redirect
router.get('/', authenticate, getPurchases);     // admin only

export default router;
