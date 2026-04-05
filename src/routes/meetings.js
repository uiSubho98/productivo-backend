import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { authenticate, requireOrgMember, requireOrgAdmin } from '../middleware/auth.js';
import {
  create,
  getAll,
  getById,
  update,
  remove,
  cancel,
  addNotes,
  generateNotesPdf,
  sendNotes,
} from '../controllers/meetingController.js';

const router = Router();

// All org members can view meetings, but only admins can create/delete
router.use(authenticate, requireOrgMember);

router.post(
  '/',
  requireOrgAdmin,
  validate([
    body('title').notEmpty().withMessage('Meeting title is required').trim(),
    body('scheduledAt')
      .notEmpty()
      .withMessage('Scheduled time is required')
      .isISO8601()
      .withMessage('Must be a valid ISO 8601 date'),
    body('duration')
      .optional()
      .isInt({ min: 15 })
      .withMessage('Duration must be at least 15 minutes'),
    body('attendees')
      .optional()
      .isArray()
      .withMessage('Attendees must be an array'),
    body('attendees.*.email')
      .optional()
      .isEmail()
      .withMessage('Valid attendee email required'),
  ]),
  create
);

router.get('/', getAll);

router.get('/:id', getById);

router.put(
  '/:id',
  validate([
    body('title').optional().trim().notEmpty().withMessage('Title cannot be empty'),
    body('status')
      .optional()
      .isIn(['scheduled', 'in_progress', 'completed', 'cancelled'])
      .withMessage('Invalid status'),
  ]),
  update
);

router.delete('/:id', requireOrgAdmin, remove);

router.post('/:id/cancel', requireOrgAdmin, cancel);

router.put(
  '/:id/notes',
  requireOrgAdmin,
  validate([
    body('notes').optional().isString(),
  ]),
  addNotes
);

router.post('/:id/notes/generate-pdf', requireOrgAdmin, generateNotesPdf);

router.post('/:id/notes/send', requireOrgAdmin, sendNotes);

export default router;
