import { Router } from 'express';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';
import { getAll, getById, updateUser, deleteUser } from '../controllers/userController.js';

const router = Router();

// Superadmin only
router.use(authenticate, requireSuperAdmin);

router.get('/', getAll);
router.get('/:id', getById);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

export default router;
