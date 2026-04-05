import express from 'express';
import { createEnquiry, getEnquiries, updateEnquiry } from '../controllers/enquiryController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

router.post('/', createEnquiry);                              // public
router.get('/', authenticate, getEnquiries);                  // admin only
router.patch('/:id', authenticate, updateEnquiry);            // admin only

export default router;
