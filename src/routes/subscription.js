import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { getSubscription, initiateUpgrade } from '../controllers/subscriptionController.js';

const router = Router();

// All subscription routes require auth
router.use(authenticate);

// GET /api/v1/subscription — get current plan + limits
router.get('/', getSubscription);

// POST /api/v1/subscription/upgrade — initiate Pro upgrade payment
router.post(
  '/upgrade',
  validate([
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('phone').trim().notEmpty().withMessage('Phone is required'),
  ]),
  initiateUpgrade
);

export default router;
