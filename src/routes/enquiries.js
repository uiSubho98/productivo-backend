import express from 'express';
import { createEnquiry, createPremiumEnquiry, getEnquiries, updateEnquiry } from '../controllers/enquiryController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/', createEnquiry);                              // public — landing page
router.post('/premium', authenticate, createPremiumEnquiry); // authenticated — in-app premium feature request
router.get('/', authenticate, getEnquiries);                  // admin only
router.patch('/:id', authenticate, updateEnquiry);            // admin only

export default router;
