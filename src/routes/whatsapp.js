import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { authenticate, requireOrgAdmin } from '../middleware/auth.js';
import {
  verifyWebhook,
  receiveWebhook,
  getConversations,
  getMessages,
  markConversationRead,
  sendToPhone,
  exchangeAccessToken,
  getStats,
} from '../controllers/whatsappController.js';

const router = Router();

// ── Webhook (no auth — called by Meta servers) ───────────────
router.get('/webhook', verifyWebhook);
router.post('/webhook', receiveWebhook);

// ── All other routes require authentication ───────────────────
router.use(authenticate, requireOrgAdmin);

// Conversations list
router.get('/conversations', getConversations);

// Messages for a specific phone number
router.get('/conversations/:phone/messages', getMessages);

// Mark conversation as read
router.patch('/conversations/:phone/mark-read', markConversationRead);

// Send a message
router.post(
  '/conversations/:phone/send',
  validate([
    body('type').optional().isIn(['text', 'document', 'template']),
    body('message').if(body('type').equals('text')).notEmpty().withMessage('message is required for text'),
    body('documentUrl').if(body('type').equals('document')).notEmpty().withMessage('documentUrl is required for document'),
    body('templateName').if(body('type').equals('template')).notEmpty().withMessage('templateName is required for template'),
  ]),
  sendToPhone
);

// Token management
router.post(
  '/token/exchange',
  validate([body('shortLivedToken').notEmpty().withMessage('shortLivedToken is required')]),
  exchangeAccessToken
);

// Rate-limit stats
router.get('/stats', getStats);

export default router;
