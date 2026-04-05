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
  generatePdf,
  sendInvoice,
  downloadInvoice,
  downloadReceipt,
  addPayment,
  updatePayment,
  removePayment,
  reviseInvoice,
} from '../controllers/invoiceController.js';

const router = Router();

router.use(authenticate, requireOrgAdmin);

router.post(
  '/',
  checkLimit('invoices'),
  validate([
    body('clientId')
      .notEmpty()
      .withMessage('clientId is required')
      .isMongoId()
      .withMessage('Invalid clientId'),
    body('items')
      .isArray({ min: 1 })
      .withMessage('At least one item is required'),
    body('items.*.description')
      .notEmpty()
      .withMessage('Item description is required'),
    body('items.*.quantity')
      .isFloat({ min: 0.01 })
      .withMessage('Quantity must be greater than 0'),
    body('items.*.rate')
      .isFloat({ min: 0 })
      .withMessage('Rate must be non-negative'),
  ]),
  create
);

router.get('/', getAll);

router.get('/:id', getById);

router.put(
  '/:id',
  validate([
    body('status')
      .optional()
      .isIn(['draft', 'sent', 'paid', 'overdue', 'cancelled'])
      .withMessage('Invalid status'),
  ]),
  update
);

router.post('/:id/generate-pdf', generatePdf);
router.get('/:id/download', downloadInvoice);
router.get('/:id/receipt', downloadReceipt);

router.post('/:id/send', sendInvoice);
router.post('/:id/revise', reviseInvoice);

router.post(
  '/:id/payments',
  validate([
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    body('date').notEmpty().withMessage('Date is required'),
    body('method')
      .optional()
      .isIn(['bank_transfer', 'upi', 'cash', 'cheque', 'other'])
      .withMessage('Invalid payment method'),
  ]),
  addPayment
);

router.put('/:id/payments/:paymentId', updatePayment);
router.delete('/:id/payments/:paymentId', removePayment);

export default router;
