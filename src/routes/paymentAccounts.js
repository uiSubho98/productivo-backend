import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { authenticate, requireOrg, requireOrgAdmin } from '../middleware/auth.js';
import {
  create,
  getAll,
  getById,
  update,
  remove,
  setDefault,
} from '../controllers/paymentAccountController.js';

const router = Router();

router.use(authenticate);

router.get('/', requireOrg, getAll);

router.post(
  '/',
  requireOrgAdmin,
  validate([
    body('accountName').notEmpty().withMessage('Account name is required').trim(),
    body('type').isIn(['bank', 'upi', 'qr']).withMessage('Type must be bank, upi, or qr'),
  ]),
  create
);

router.get('/:id', requireOrg, getById);

router.put(
  '/:id',
  requireOrgAdmin,
  validate([
    body('accountName').optional().trim().notEmpty().withMessage('Account name cannot be empty'),
    body('type').optional().isIn(['bank', 'upi', 'qr']).withMessage('Type must be bank, upi, or qr'),
  ]),
  update
);

router.delete('/:id', requireOrgAdmin, remove);

router.post('/:id/default', requireOrgAdmin, setDefault);

export default router;
