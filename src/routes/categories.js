import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { authenticate, requireOrgAdmin } from '../middleware/auth.js';
import {
  create,
  getAll,
  update,
  remove,
  seedDefaults,
} from '../controllers/categoryController.js';

const router = Router();

router.use(authenticate, requireOrgAdmin);

router.post(
  '/',
  validate([
    body('name').notEmpty().withMessage('Category name is required').trim(),
  ]),
  create
);

router.get('/', getAll);

router.post('/seed', requireOrgAdmin, seedDefaults);

router.put(
  '/:id',
  validate([
    body('name').notEmpty().withMessage('Category name is required').trim(),
  ]),
  update
);

router.delete('/:id', remove);

export default router;
