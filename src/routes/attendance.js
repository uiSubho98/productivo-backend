import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  clockIn,
  clockOut,
  myToday,
  myHistory,
  adminList,
  exportExcel,
  listMembers,
} from '../controllers/attendanceController.js';

const router = Router();
router.use(authenticate);

// Self-service (any role)
router.post('/clock-in', clockIn);
router.post('/clock-out', clockOut);
router.get('/me/today', myToday);
router.get('/me', myHistory);

// Admin (superadmin + org_admin)
router.get('/', adminList);
router.get('/export', exportExcel);
router.get('/members', listMembers);

export default router;
