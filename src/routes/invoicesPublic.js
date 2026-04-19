import { Router } from 'express';
import { streamInvoicePdf } from '../controllers/invoicePublicController.js';

const router = Router();

// PUBLIC — no auth. Used by WABridge/Meta to fetch the invoice PDF as a document header.
// URL intentionally ends in `.pdf` so content-sniffing downstream recognises it.
router.get('/:invoiceId/invoice.pdf', streamInvoicePdf);

export default router;
