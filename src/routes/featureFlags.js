/**
 * Feature flag routes.
 * Base: /api/v1/feature-flags
 *
 * Public (any authenticated org member):
 *   GET /whatsapp/me   — check own WhatsApp addon status
 *
 * Product owner only:
 *   GET /whatsapp
 *   GET /whatsapp/:superadminId
 *   PUT /whatsapp/:superadminId
 */
import { Router } from 'express';
import { authenticate, requireProductOwner, requireOrgMember } from '../middleware/auth.js';
import {
  getMyWhatsappStatus,
  listWhatsappFlags,
  getWhatsappFlag,
  setWhatsappFlag,
} from '../controllers/featureFlagController.js';

const router = Router();

// Any authenticated org member can check their own addon status
router.get('/whatsapp/me', authenticate, requireOrgMember, getMyWhatsappStatus);

// Product-owner-only management routes
router.get('/whatsapp', authenticate, requireProductOwner, listWhatsappFlags);
router.get('/whatsapp/:superadminId', authenticate, requireProductOwner, getWhatsappFlag);
router.put('/whatsapp/:superadminId', authenticate, requireProductOwner, setWhatsappFlag);

export default router;
