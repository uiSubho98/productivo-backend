import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getAll, getById, updateUser, deleteUser } from '../controllers/userController.js';

const router = Router();

// Superadmin only — scoped to their master org tree
const requireSuperadmin = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Superadmin access required.' });
  }
  if (!req.user.organizationId) {
    return res.status(403).json({ success: false, error: 'You must create an organization first.', code: 'NO_ORG' });
  }
  next();
};

router.use(authenticate, requireSuperadmin);

router.get('/', getAll);
router.get('/:id', getById);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

export default router;
