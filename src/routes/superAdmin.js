import { Router } from 'express';
import { authenticate, requireProductOwner } from '../middleware/auth.js';
import { getOverview, getLogs, getPayments, getUsers, blockSuperadmin, deleteSuperadminAccount } from '../controllers/superAdminController.js';

const router = Router();

router.use(authenticate, requireProductOwner);

router.get('/users', getUsers);
router.get('/overview', getOverview);
router.get('/logs', getLogs);
router.get('/payments', getPayments);

router.patch('/accounts/:id/block', blockSuperadmin);
router.delete('/accounts/:id', deleteSuperadminAccount);

export default router;
