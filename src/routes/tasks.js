import { Router } from 'express';
import { body } from 'express-validator';
import validate from '../middleware/validate.js';
import { authenticate, requireOrgMember, requireOrgAdmin } from '../middleware/auth.js';
import { uploadSingle, handleUploadError } from '../middleware/upload.js';
import {
  create, getAll, getById, update, remove, addSubtask, updateSubtask, addAttachment,
} from '../controllers/taskController.js';
import {
  startTimer, stopTimer, getTimerState, listTaskLogs,
} from '../controllers/taskTimerController.js';

const router = Router();

router.use(authenticate, requireOrgMember);

// All org members can view tasks (employees see only their assigned tasks in controller)
router.get('/', getAll);
router.get('/:id', getById);

// org_admin + superadmin can create/update/delete
router.post('/',
  requireOrgAdmin,
  validate([
    body('title').notEmpty().withMessage('Task title is required').trim(),
    body('projectId').notEmpty().withMessage('projectId is required').isMongoId(),
    body('status').optional().isIn(['todo', 'in_progress', 'in_review', 'done']),
    body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  ]),
  create
);

router.put('/:id',
  validate([
    body('title').optional().trim().notEmpty(),
    body('status').optional().isIn(['todo', 'in_progress', 'in_review', 'done']),
    body('priority').optional().isIn(['low', 'medium', 'high', 'urgent']),
  ]),
  update  // Controller allows employees to update status of their own tasks
);

router.delete('/:id', requireOrgAdmin, remove);

router.post('/:id/subtasks',
  validate([body('title').notEmpty().trim()]),
  addSubtask
);

router.put('/:id/subtasks/:subtaskId',
  validate([body('status').optional().isIn(['todo', 'in_progress', 'done'])]),
  updateSubtask
);

router.post('/:id/attachments', uploadSingle('file'), handleUploadError, addAttachment);

// Task timer — any org member can track their own time on any task they can view
router.get('/:id/timer', getTimerState);
router.post('/:id/timer/start', startTimer);
router.post('/:id/timer/stop', stopTimer);
router.get('/:id/time-logs', listTaskLogs);

export default router;
