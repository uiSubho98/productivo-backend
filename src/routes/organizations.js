import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { authenticate, requireOrg, requireOrgAdmin } from '../middleware/auth.js';
import { checkLimit } from '../middleware/planLimits.js';
import {
  create,
  getAll,
  getById,
  update,
  remove,
  getMembers,
  addMember,
  removeMember,
  updateInvoicePermission,
} from '../controllers/organizationController.js';

const router = Router();

router.use(authenticate);

// Anyone logged in can list their orgs or create one
router.get('/', getAll);

router.post(
  '/',
  // Only enforce sub-org limit when creating a child org (parentOrgId present).
  // Master org creation is always allowed — free users need to create their first org.
  (req, res, next) => req.body.parentOrgId ? checkLimit('subOrgs')(req, res, next) : next(),
  validate([
    body('name').notEmpty().withMessage('Organization name is required').trim(),
  ]),
  create
);

// These need org membership
router.get('/:id', requireOrg, getById);
router.put('/:id', requireOrgAdmin, update);
router.delete('/:id', requireOrgAdmin, remove);
router.get('/:id/members', requireOrg, getMembers);
router.post(
  '/:id/members',
  requireOrgAdmin,
  checkLimit('users'),
  validate([
    body('email').notEmpty().withMessage('Email is required').isEmail(),
    body('name').optional().trim(),
    body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 chars'),
    body('role').optional().isIn(['org_admin', 'employee']),
  ]),
  addMember
);

router.delete('/:id/members/:userId', requireOrgAdmin, removeMember);

// Invoice view permission — only superadmin (owner) or product_owner
router.patch('/:id/invoice-permission', requireOrgAdmin, updateInvoicePermission);

export default router;
