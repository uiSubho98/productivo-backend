import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { authenticate, requireOrgAdmin } from '../middleware/auth.js';
import { checkLimit } from '../middleware/planLimits.js';
import {
  create,
  getAll,
  getById,
  update,
  remove,
  updatePipelineStage,
  addNote,
  getByPipeline,
} from '../controllers/clientController.js';

const router = Router();

router.use(authenticate, requireOrgAdmin);

router.post(
  '/',
  checkLimit('clients'),
  validate([
    body('name').notEmpty().withMessage('Client name is required').trim(),
    body('email').optional().isEmail().withMessage('Valid email required').normalizeEmail(),
  ]),
  create
);

router.get('/', getAll);

router.get('/pipeline', getByPipeline);

router.get('/:id', getById);

router.put(
  '/:id',
  validate([
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('email').optional().isEmail().withMessage('Valid email required').normalizeEmail(),
  ]),
  update
);

router.delete('/:id', remove);

router.patch(
  '/:id/pipeline',
  validate([
    body('pipelineStage')
      .isIn(['lead', 'contacted', 'quotation_sent', 'quotation_revised', 'mvp_shared', 'converted', 'lost'])
      .withMessage('Invalid pipeline stage'),
  ]),
  updatePipelineStage
);

router.post(
  '/:id/notes',
  validate([
    body('text').optional().trim(),
    body('content').optional().trim(),
  ]),
  addNote
);

export default router;
