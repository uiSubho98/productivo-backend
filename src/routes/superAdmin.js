import { Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { getOverview, getLogs } from '../controllers/superAdminController.js';

const router = Router();

router.use(authenticate, requireSuperAdmin);

router.get('/overview', getOverview);
router.get('/logs', getLogs);

export default router;
