import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getUsageOverview, listSuperadminsForUsage } from '../controllers/usageController.js';

const router = Router();
router.use(authenticate);
router.get('/overview', getUsageOverview);
router.get('/superadmins', listSuperadminsForUsage);

export default router;
