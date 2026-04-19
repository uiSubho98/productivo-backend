import mongoose from 'mongoose';
import { google } from 'googleapis';
import Invoice from '../models/Invoice.js';
import { getGoogleAuthClient } from '../config/googleAuth.js';

/**
 * Extract a Google Drive fileId from the pdfUrl we store on Invoice.
 * Matches patterns like:
 *   https://drive.google.com/uc?id=<fileId>&export=download
 *   https://drive.google.com/file/d/<fileId>/view
 */
function extractDriveFileId(url) {
  if (!url) return null;
  const a = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (a) return a[1];
  const b = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (b) return b[1];
  return null;
}

/**
 * GET /api/v1/public/invoices/:invoiceId/invoice.pdf
 * PUBLIC endpoint — WhatsApp / WABridge / Meta fetch this to attach the PDF
 * to a DOCUMENT-header template message.
 *
 * Security: only serves PDFs for known Invoice records (can't use as a generic
 * Drive proxy). Fails fast if the invoice doesn't exist or has no pdfUrl.
 */
export const streamInvoicePdf = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(invoiceId)) {
      return res.status(404).send('Not found');
    }

    const invoice = await Invoice.findById(invoiceId).select('pdfUrl invoiceNumber');
    if (!invoice || !invoice.pdfUrl) {
      return res.status(404).send('Invoice PDF not available');
    }

    const fileId = extractDriveFileId(invoice.pdfUrl);
    if (!fileId) {
      return res.status(500).send('Invalid PDF URL on invoice');
    }

    const auth = getGoogleAuthClient();
    const drive = google.drive({ version: 'v3', auth });

    // Stream the file bytes directly from Drive (authenticated via our service account)
    const driveRes = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    const filename = `${invoice.invoiceNumber || 'invoice'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=3600'); // 1h — allow Meta/WA to cache

    driveRes.data
      .on('error', (err) => {
        console.error('streamInvoicePdf drive stream error:', err.message);
        if (!res.headersSent) res.status(502).end();
      })
      .pipe(res);
  } catch (err) {
    console.error('streamInvoicePdf error:', err.message);
    if (!res.headersSent) res.status(500).send('Failed to stream PDF');
  }
};
