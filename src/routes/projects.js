import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { authenticate, requireOrgAdmin } from '../middleware/auth.js';
import { checkLimit } from '../middleware/planLimits.js';
import {
  create, getAll, getById, update, remove, getStats,
  addMember, removeMember, updateMember,
} from '../controllers/projectController.js';

const router = Router();

router.use(authenticate, requireOrgAdmin);

router.get('/', getAll);
router.get('/:id', getById);
router.get('/:id/stats', getStats);

router.post('/',
  checkLimit('projects'),
  validate([
    body('name').notEmpty().withMessage('Project name is required').trim(),
    body('status').optional().isIn(['planning', 'active', 'on_hold', 'completed', 'cancelled']),
  ]),
  create
);

router.put('/:id',
  validate([
    body('name').optional().trim().notEmpty(),
    body('status').optional().isIn(['planning', 'active', 'on_hold', 'completed', 'cancelled']),
  ]),
  update
);

router.delete('/:id', remove);

// ── Project members ──────────────────────────────────────────
router.post(
  '/:id/members',
  validate([
    body('role').optional().isIn(['employee', 'client', 'maintainer']),
  ]),
  addMember
);

router.put('/:id/members/:memberId', updateMember);
router.delete('/:id/members/:memberId', removeMember);

export default router;
