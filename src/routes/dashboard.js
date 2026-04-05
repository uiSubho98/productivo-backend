import { Router } from 'express';
import { authenticate, requireOrgAdmin } from '../middleware/auth.js';
import { getStats } from '../controllers/dashboardController.js';

const router = Router();

router.use(authenticate, requireOrgAdmin);

router.get('/stats', getStats);

export default router;
