import PdfPrinter from 'pdfmake';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import https from 'https';
import http from 'http';
import { formatCurrency, formatDate } from '../utils/helpers.js';

/** Fetch a remote image URL and return a base64 data URI, or null on failure. */
const fetchImageAsDataUri = (url) =>
  new Promise((resolve) => {
    if (!url) return resolve(null);
    try {
      const lib = url.startsWith('https') ? https : http;
      lib.get(url, (res) => {
        if (res.statusCode !== 200) return resolve(null);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const mime = res.headers['content-type']?.split(';')[0] || 'image/png';
          resolve(`data:${mime};base64,${buf.toString('base64')}`);
        });
        res.on('error', () => resolve(null));
      }).on('error', () => resolve(null));
    } catch {
      resolve(null);
    }
  });

const require = createRequire(import.meta.url);
const pdfMakePath = dirname(require.resolve('pdfmake/package.json'));

// pdfmake ships fonts as base64 inside vfs_fonts.js — use those instead of file paths
const vfsFonts = require(join(pdfMakePath, 'build', 'vfs_fonts.js'));
const vfs = vfsFonts.pdfMake?.vfs ?? vfsFonts.vfs ?? vfsFonts;

const fonts = {
  Roboto: {
    normal:      Buffer.from(vfs['Roboto-Regular.ttf'],       'base64'),
    bold:        Buffer.from(vfs['Roboto-Medium.ttf'],        'base64'),
    italics:     Buffer.from(vfs['Roboto-Italic.ttf'],        'base64'),
    bolditalics: Buffer.from(vfs['Roboto-MediumItalic.ttf'],  'base64'),
  },
};

/** Build a PDFMake doc and return a Buffer. */
const generatePdfBuffer = (docDefinition) =>
  new Promise((resolve, reject) => {
    try {
      const printer = new PdfPrinter(fonts);
      const pdfDoc = printer.createPdfKitDocument(docDefinition);
      const chunks = [];
      pdfDoc.on('data', (chunk) => chunks.push(chunk));
      pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
      pdfDoc.on('error', reject);
      pdfDoc.end();
    } catch (error) {
      reject(error);
    }
  });

// ─── Design tokens ─────────────────────────────────────────────────────────────
const ACCENT      = '#1E40AF'; // indigo-800
const ACCENT_LIGHT= '#EFF6FF'; // blue-50
const DARK        = '#0F172A'; // slate-900
const MID         = '#334155'; // slate-700
const MUTED       = '#64748B'; // slate-500
const LIGHT       = '#94A3B8'; // slate-400
const BORDER      = '#E2E8F0'; // slate-200
const BG_SOFT     = '#F8FAFC'; // slate-50
const WHITE       = '#FFFFFF';
const SUCCESS     = '#047857'; // emerald-700
const SUCCESS_BG  = '#ECFDF5'; // emerald-50
const DANGER      = '#B91C1C'; // red-700
const ROW_ALT     = '#F8FAFC';

const statusBadgeColor = (status) => ({
  paid: SUCCESS, draft: LIGHT, sent: ACCENT, overdue: DANGER, cancelled: LIGHT,
}[status] || MUTED);

const divider = (color = BORDER, weight = 0.5) => ({
  canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: weight, lineColor: color }],
  margin: [0, 0],
});

const labelValue = (label, value) => ({
  columns: [
    { text: label, width: 120, color: MUTED, fontSize: 8.5 },
    { text: value || '—', width: '*', color: MID, fontSize: 8.5, bold: true },
  ],
  margin: [0, 2.5, 0, 0],
});

const sectionTitle = (title, accentColor = ACCENT) => ({
  stack: [
    { text: '', margin: [0, 6] },
    {
      columns: [
        { canvas: [{ type: 'rect', x: 0, y: 1, w: 3, h: 11, r: 1.5, color: accentColor }], width: 9 },
        { text: title, fontSize: 9.5, bold: true, color: DARK, margin: [5, 0, 0, 0] },
      ],
    },
    { text: '', margin: [0, 3] },
    divider(BORDER, 0.5),
    { text: '', margin: [0, 3] },
  ],
});

/**
 * Generate a premium invoice PDF.
 * @param {Object} invoiceData
 * @param {Object} orgData
 * @param {Object} clientData
 * @returns {Buffer}
 */
export const generateInvoicePdf = async (invoiceData, orgData, clientData) => {
  const paymentAccounts = invoiceData.paymentAccounts || (invoiceData.paymentAccount ? [invoiceData.paymentAccount] : []);

  // Fetch logos and QR images in parallel
  const qrAccounts = paymentAccounts.filter((a) => a.type === 'qr' && a.qrImageUrl);
  const [orgLogoUri, clientLogoUri, ...qrDataUris] = await Promise.all([
    fetchImageAsDataUri(orgData.logo),
    fetchImageAsDataUri(clientData.logo),
    ...qrAccounts.map((a) => fetchImageAsDataUri(a.qrImageUrl)),
  ]);
  // Map QR account id → data URI
  const qrUriMap = {};
  qrAccounts.forEach((a, i) => { qrUriMap[a._id?.toString() || i] = qrDataUris[i]; });

  // ── Items table ───────────────────────────────────────────────────────────────
  const tableBody = [
    [
      { text: '#',           style: 'thCell', alignment: 'center' },
      { text: 'Description', style: 'thCell' },
      { text: 'Qty',         style: 'thCell', alignment: 'center' },
      { text: 'Rate',        style: 'thCell', alignment: 'right' },
      { text: 'Amount',      style: 'thCell', alignment: 'right' },
    ],
    ...invoiceData.items.map((item, index) => {
      const bg = index % 2 === 0 ? WHITE : ROW_ALT;
      return [
        { text: (index + 1).toString(), fillColor: bg, alignment: 'center', color: LIGHT, fontSize: 8, margin: [0, 4, 0, 4] },
        { text: item.description, fillColor: bg, color: MID, fontSize: 8.5, margin: [0, 4, 0, 4] },
        { text: item.quantity.toString(), fillColor: bg, alignment: 'center', color: MID, fontSize: 8.5, margin: [0, 4, 0, 4] },
        { text: formatCurrency(item.rate), fillColor: bg, alignment: 'right', color: MID, fontSize: 8.5, margin: [0, 4, 0, 4] },
        { text: formatCurrency(item.amount), fillColor: bg, alignment: 'right', bold: true, color: DARK, fontSize: 8.5, margin: [0, 4, 0, 4] },
      ];
    }),
  ];

  const orgAddressParts = [
    orgData.address?.street,
    orgData.address?.city,
    orgData.address?.state,
    orgData.address?.zipCode,
    orgData.address?.country,
  ].filter(Boolean);

  const clientAddressParts = [
    clientData.address?.street,
    clientData.address?.city,
    clientData.address?.state,
    clientData.address?.zipCode,
    clientData.address?.country,
  ].filter(Boolean);

  // ── Payment history table ─────────────────────────────────────────────────────
  const payments = invoiceData.payments || [];
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const balanceDue = Math.max(invoiceData.total - totalPaid, 0);

  const paymentHistoryBody = [
    [
      { text: '#',         style: 'thCell', alignment: 'center' },
      { text: 'Date',      style: 'thCell' },
      { text: 'Method',    style: 'thCell' },
      { text: 'Reference', style: 'thCell' },
      { text: 'Amount',    style: 'thCell', alignment: 'right' },
    ],
    ...payments.map((p, i) => {
      const bg = i % 2 === 0 ? WHITE : ROW_ALT;
      return [
        { text: (i + 1).toString(), fillColor: bg, alignment: 'center', color: LIGHT, fontSize: 8 },
        { text: formatDate(p.date), fillColor: bg, color: MID, fontSize: 8 },
        { text: p.method ? p.method.replace(/_/g, ' ') : '—', fillColor: bg, color: MID, fontSize: 8 },
        { text: p.reference || '—', fillColor: bg, color: MUTED, fontSize: 8 },
        { text: formatCurrency(p.amount), fillColor: bg, alignment: 'right', bold: true, color: DARK, fontSize: 8 },
      ];
    }),
  ];

  // ── Org header column (left side) ────────────────────────────────────────────
  const orgHeaderStack = [];
  if (orgLogoUri) {
    orgHeaderStack.push({ image: orgLogoUri, width: 48, height: 48, margin: [0, 0, 0, 6] });
  }
  orgHeaderStack.push({ text: orgData.name, style: 'orgName' });
  if (orgData.cinNumber)         orgHeaderStack.push({ text: `CIN: ${orgData.cinNumber}`, style: 'orgMeta' });
  if (orgAddressParts.length)    orgHeaderStack.push({ text: orgAddressParts.join(', '), style: 'orgMeta' });
  if (orgData.phone)             orgHeaderStack.push({ text: orgData.phone, style: 'orgMeta' });
  if (orgData.email)             orgHeaderStack.push({ text: orgData.email, style: 'orgMeta' });
  if (orgData.website)           orgHeaderStack.push({ text: orgData.website, style: 'orgMeta', color: ACCENT });

  // ── FROM block ───────────────────────────────────────────────────────────────
  const fromStack = [
    { text: 'FROM', style: 'blockLabel' },
    { text: '', margin: [0, 2] },
    ...(orgLogoUri ? [{ image: orgLogoUri, width: 28, height: 28, margin: [0, 0, 0, 3] }] : []),
    { text: orgData.name, bold: true, fontSize: 9.5, color: DARK },
    ...(orgData.cinNumber ? [{ text: `CIN: ${orgData.cinNumber}`, fontSize: 8, color: MUTED, margin: [0, 1, 0, 0] }] : []),
    ...(orgAddressParts.length ? [{ text: orgAddressParts.join(', '), fontSize: 8, color: MID, margin: [0, 1, 0, 0] }] : []),
    ...(orgData.phone ? [{ text: orgData.phone, fontSize: 8, color: MID, margin: [0, 1, 0, 0] }] : []),
    ...(orgData.email ? [{ text: orgData.email, fontSize: 8, color: MID, margin: [0, 1, 0, 0] }] : []),
  ];

  // ── BILL TO block ────────────────────────────────────────────────────────────
  const billToStack = [
    { text: 'BILL TO', style: 'blockLabel', alignment: 'right' },
    { text: '', margin: [0, 2] },
    ...(clientLogoUri ? [{ image: clientLogoUri, width: 28, height: 28, margin: [0, 0, 0, 3], alignment: 'right' }] : []),
    { text: clientData.name, bold: true, fontSize: 9.5, color: DARK, alignment: 'right' },
    ...(clientData.companyName ? [{ text: clientData.companyName, fontSize: 8, color: MID, alignment: 'right', italics: true, margin: [0, 1, 0, 0] }] : []),
    ...(clientData.email ? [{ text: clientData.email, fontSize: 8, color: MID, alignment: 'right', margin: [0, 1, 0, 0] }] : []),
    ...(clientData.phoneNumber ? [{ text: clientData.phoneNumber, fontSize: 8, color: MID, alignment: 'right', margin: [0, 1, 0, 0] }] : []),
    ...(clientData.gstNumber ? [{ text: `GSTIN: ${clientData.gstNumber}`, fontSize: 8, color: MID, alignment: 'right', margin: [0, 1, 0, 0] }] : []),
    ...(clientData.cinNumber ? [{ text: `CIN: ${clientData.cinNumber}`, fontSize: 8, color: MID, alignment: 'right', margin: [0, 1, 0, 0] }] : []),
    ...(clientAddressParts.length ? [{ text: clientAddressParts.join(', '), fontSize: 8, color: MID, alignment: 'right', margin: [0, 1, 0, 0] }] : []),
  ];

  // ── Totals block ─────────────────────────────────────────────────────────────
  const showTax = invoiceData.taxPercentage > 0 && invoiceData.taxAmount > 0;
  const hasPayments = payments.length > 0;
  // If partial/fully paid, the "due" box shows balance, not full total
  const displayDue = balanceDue;
  const isFullyPaid = balanceDue <= 0;
  const dueBoxColor = isFullyPaid ? SUCCESS : ACCENT;

  const totalsStack = [
    divider(BORDER, 0.5),
    {
      columns: [
        { text: 'Subtotal', width: '*', color: MUTED, fontSize: 8.5, margin: [0, 5, 0, 0] },
        { text: formatCurrency(invoiceData.subtotal), alignment: 'right', fontSize: 8.5, color: MID, margin: [0, 5, 0, 0] },
      ],
    },
    ...(showTax ? [{
      columns: [
        { text: `Tax (${invoiceData.taxPercentage}%)`, width: '*', color: MUTED, fontSize: 8.5, margin: [0, 3, 0, 0] },
        { text: formatCurrency(invoiceData.taxAmount), alignment: 'right', fontSize: 8.5, color: MID, margin: [0, 3, 0, 0] },
      ],
    }] : []),
    ...(hasPayments ? [
      {
        columns: [
          { text: 'Invoice Total', width: '*', color: MUTED, fontSize: 8.5, margin: [0, 3, 0, 0] },
          { text: formatCurrency(invoiceData.total), alignment: 'right', fontSize: 8.5, color: MID, margin: [0, 3, 0, 0] },
        ],
      },
      {
        columns: [
          { text: 'Amount Paid', width: '*', color: SUCCESS, fontSize: 8.5, margin: [0, 3, 0, 0] },
          { text: `− ${formatCurrency(totalPaid)}`, alignment: 'right', fontSize: 8.5, color: SUCCESS, bold: true, margin: [0, 3, 0, 0] },
        ],
      },
    ] : []),
    { text: '', margin: [0, 5] },
    { canvas: [{ type: 'rect', x: 0, y: 0, w: 230, h: 34, r: 5, color: dueBoxColor }] },
    {
      columns: [
        { text: isFullyPaid ? 'PAID IN FULL' : 'BALANCE DUE', fontSize: 9.5, bold: true, color: WHITE, margin: [12, -28, 0, 0] },
        { text: formatCurrency(displayDue), alignment: 'right', fontSize: 13, bold: true, color: WHITE, margin: [0, -28, 12, 0] },
      ],
    },
    { text: '', margin: [0, 6] },
  ];

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [40, 36, 40, 48],

    footer: (currentPage, pageCount) => ({
      columns: [
        {
          text: [
            orgData.name,
            orgData.website ? `  ·  ${orgData.website}` : '',
            orgData.phone   ? `  ·  ${orgData.phone}`   : '',
          ].join(''),
          fontSize: 7, color: LIGHT, margin: [40, 0, 0, 0],
        },
        {
          text: `Page ${currentPage} of ${pageCount}`,
          fontSize: 7, color: LIGHT, alignment: 'right', margin: [0, 0, 40, 0],
        },
      ],
      margin: [0, 10, 0, 0],
    }),

    content: [
      // ── TOP ACCENT BAND ───────────────────────────────────────────────────────
      {
        canvas: [
          { type: 'rect', x: 0, y: 0, w: 515, h: 5, r: 0, color: ACCENT },
        ],
        margin: [0, 0, 0, 16],
      },

      // ── ORG LOGO + NAME (left) | INVOICE META (right) ────────────────────────
      {
        columns: [
          // Left: logo + org name
          {
            width: '55%',
            stack: orgHeaderStack,
          },
          // Right: INVOICE label + meta pill
          {
            width: '45%',
            stack: [
              { text: 'INVOICE', style: 'invoiceLabel', alignment: 'right' },
              { text: '', margin: [0, 5] },
              // Meta box
              {
                canvas: [{ type: 'rect', x: 0, y: 0, w: 220, h: 68, r: 6, color: BG_SOFT }],
                margin: [0, 0, 0, -68],
              },
              {
                stack: [
                  {
                    columns: [
                      { text: 'Invoice #', width: '*', alignment: 'right', color: MUTED, fontSize: 8, margin: [0, 8, 12, 0] },
                      { text: invoiceData.invoiceNumber, width: 'auto', alignment: 'right', bold: true, fontSize: 8, color: DARK, margin: [0, 8, 12, 0] },
                    ],
                  },
                  {
                    columns: [
                      { text: 'Date', width: '*', alignment: 'right', color: MUTED, fontSize: 8, margin: [0, 4, 12, 0] },
                      { text: formatDate(invoiceData.createdAt || invoiceData.date), width: 'auto', alignment: 'right', bold: true, fontSize: 8, color: DARK, margin: [0, 4, 12, 0] },
                    ],
                  },
                  ...(invoiceData.dueDate ? [{
                    columns: [
                      { text: 'Due Date', width: '*', alignment: 'right', color: MUTED, fontSize: 8, margin: [0, 4, 12, 0] },
                      { text: formatDate(invoiceData.dueDate), width: 'auto', alignment: 'right', bold: true, fontSize: 8, color: DARK, margin: [0, 4, 12, 0] },
                    ],
                  }] : []),
                  {
                    columns: [
                      { text: 'Status', width: '*', alignment: 'right', color: MUTED, fontSize: 8, margin: [0, 4, 12, invoiceData.project ? 0 : 8] },
                      { text: (invoiceData.status || 'draft').toUpperCase(), width: 'auto', alignment: 'right', bold: true, fontSize: 8, color: statusBadgeColor(invoiceData.status), margin: [0, 4, 12, invoiceData.project ? 0 : 8] },
                    ],
                  },
                  ...(invoiceData.project?.name ? [{
                    columns: [
                      { text: 'Project', width: '*', alignment: 'right', color: MUTED, fontSize: 8, margin: [0, 4, 12, 8] },
                      { text: invoiceData.project.name, width: 'auto', alignment: 'right', bold: true, fontSize: 8, color: DARK, margin: [0, 4, 12, 8] },
                    ],
                  }] : []),
                ],
              },
            ],
          },
        ],
      },

      { text: '', margin: [0, 12] },

      // ── THICK DIVIDER ─────────────────────────────────────────────────────────
      divider(ACCENT, 1.5),

      { text: '', margin: [0, 10] },

      // ── FROM / BILL TO ────────────────────────────────────────────────────────
      {
        columns: [
          { width: '50%', stack: fromStack },
          { width: '50%', stack: billToStack },
        ],
      },

      { text: '', margin: [0, 12] },

      // ── LINE ITEMS ────────────────────────────────────────────────────────────
      {
        table: {
          headerRows: 1,
          widths: [24, '*', 40, 80, 84],
          body: tableBody,
        },
        layout: {
          hLineWidth: (i) => (i === 0 || i === 1 ? 0 : 0.5),
          vLineWidth: () => 0,
          hLineColor: () => BORDER,
          paddingLeft:  () => 8,
          paddingRight: () => 8,
          paddingTop:   () => 0,
          paddingBottom:() => 0,
          fillColor: (i) => i === 0 ? ACCENT : null,
        },
      },

      { text: '', margin: [0, 10] },

      // ── TOTALS ────────────────────────────────────────────────────────────────
      {
        columns: [
          { width: '*', text: '' },
          { width: 230, stack: totalsStack },
        ],
      },

      // ── NOTES ─────────────────────────────────────────────────────────────────
      ...(invoiceData.notes ? [
        sectionTitle('Notes'),
        { text: invoiceData.notes, fontSize: 8.5, color: MID, lineHeight: 1.4, margin: [0, 0, 0, 2] },
      ] : []),

      // ── PAYMENT DETAILS ───────────────────────────────────────────────────────
      ...(paymentAccounts.length > 0 ? (() => {
        // Separate QR accounts from text accounts
        const textAccounts = paymentAccounts.filter((a) => a.type !== 'qr');
        const qrAccount    = paymentAccounts.find((a) => a.type === 'qr');

        // Build a table for a text-based account (bank / upi)
        const buildAccountTable = (account) => {
          const rows = [];
          const addRow = (label, value) => {
            if (!value) return;
            rows.push([
              { text: label, color: MUTED, fontSize: 8.5, border: [false, false, false, false], margin: [0, 3, 8, 3] },
              { text: value, color: DARK,  fontSize: 8.5, bold: true, border: [false, false, false, false], margin: [0, 3, 0, 3] },
            ]);
          };
          if (account.type === 'bank') {
            addRow('Account Holder', account.accountHolderName);
            addRow('Bank Name',      account.bankName);
            addRow('Account Number', account.accountNumber);
            addRow('IFSC Code',      account.ifscCode);
          } else if (account.type === 'upi') {
            addRow('Account Holder', account.accountHolderName);
            addRow('UPI ID',         account.upiId);
          }
          return {
            stack: [
              {
                table: {
                  widths: [110, '*'],
                  body: [
                    // Header row
                    [
                      {
                        colSpan: 2,
                        text: account.type === 'bank' ? 'Bank Transfer' : 'UPI Payment',
                        fontSize: 9, bold: true, color: WHITE,
                        fillColor: ACCENT,
                        border: [false, false, false, false],
                        margin: [10, 8, 10, 8],
                      },
                      {},
                    ],
                    // Account name sub-header
                    ...(account.accountName ? [[
                      {
                        colSpan: 2,
                        text: account.accountName,
                        fontSize: 8, color: MUTED, italics: true,
                        border: [false, false, false, true],
                        borderColor: [null, null, null, BORDER],
                        margin: [10, 4, 10, 6],
                        fillColor: BG_SOFT,
                      },
                      {},
                    ]] : []),
                    // Data rows
                    ...rows.map((r) => r.map((cell) => ({ ...cell, fillColor: BG_SOFT }))),
                    // Bottom padding row
                    [
                      { text: '', border: [false, false, false, false], margin: [0, 2], fillColor: BG_SOFT },
                      { text: '', border: [false, false, false, false], fillColor: BG_SOFT },
                    ],
                  ],
                },
                layout: {
                  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
                  vLineWidth: () => 0,
                  hLineColor: () => BORDER,
                  paddingLeft:  () => 10,
                  paddingRight: () => 10,
                  paddingTop:   () => 0,
                  paddingBottom:() => 0,
                },
              },
            ],
            margin: [0, 0, 0, 10],
          };
        };

        const elements = [{ ...sectionTitle('Payment Details'), pageBreak: 'before' }];

        // Text accounts: 1 or 2 side-by-side, each in its own table
        if (textAccounts.length === 1) {
          elements.push({
            columns: [
              { width: '55%', ...buildAccountTable(textAccounts[0]) },
              { width: '*', text: '' },
            ],
          });
        } else if (textAccounts.length >= 2) {
          elements.push({
            columns: textAccounts.slice(0, 2).map((acc) => ({
              width: '50%',
              ...buildAccountTable(acc),
            })),
            columnGap: 12,
          });
        }

        // QR account: full-width block with large scannable QR image on the right
        if (qrAccount) {
          const qrUri = qrUriMap[qrAccount._id?.toString()] || null;
          elements.push({ text: '', margin: [0, 6] });

          // Header row + detail rows for QR block
          const qrTableBody = [
            // Blue header spanning all columns
            [
              {
                colSpan: 2,
                text: 'QR Code Payment',
                fontSize: 9, bold: true, color: WHITE, fillColor: ACCENT,
                border: [false, false, false, false],
                margin: [12, 9, 12, 9],
              },
              {},
            ],
            ...(qrAccount.accountName ? [[
              {
                colSpan: 2,
                text: qrAccount.accountName,
                fontSize: 8, color: MUTED, italics: true, fillColor: BG_SOFT,
                border: [false, false, false, true],
                borderColor: [null, null, null, BORDER],
                margin: [12, 5, 12, 7],
              },
              {},
            ]] : []),
            ...(qrAccount.accountHolderName ? [[
              { text: 'Account Holder', color: MUTED, fontSize: 8.5, fillColor: BG_SOFT, border: [false, false, false, false], margin: [12, 5, 8, 5] },
              { text: qrAccount.accountHolderName, color: DARK, fontSize: 8.5, bold: true, fillColor: BG_SOFT, border: [false, false, false, false], margin: [0, 5, 12, 5] },
            ]] : []),
            ...(qrAccount.upiId ? [[
              { text: 'UPI ID', color: MUTED, fontSize: 8.5, fillColor: BG_SOFT, border: [false, false, false, false], margin: [12, 5, 8, 5] },
              { text: qrAccount.upiId, color: DARK, fontSize: 8.5, bold: true, fillColor: BG_SOFT, border: [false, false, false, false], margin: [0, 5, 12, 5] },
            ]] : []),
            // Padding
            [
              { text: '', border: [false, false, false, false], fillColor: BG_SOFT, margin: [0, 4] },
              { text: '', border: [false, false, false, false], fillColor: BG_SOFT },
            ],
          ];

          // Left: info table. Right: QR image (side-by-side using outer columns)
          const leftBlock = {
            table: { widths: [120, '*'], body: qrTableBody },
            layout: {
              hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
              vLineWidth: () => 0,
              hLineColor: () => BORDER,
              paddingLeft: () => 0,
              paddingRight: () => 0,
              paddingTop: () => 0,
              paddingBottom: () => 0,
            },
          };

          const rightBlock = qrUri ? {
            stack: [
              { text: 'Scan to Pay', fontSize: 8, color: MUTED, alignment: 'center', margin: [0, 8, 0, 6] },
              { image: qrUri, width: 160, height: 160, alignment: 'center' },
            ],
          } : { text: '' };

          const qrColumns = [{ width: '*', ...leftBlock }];
          if (qrUri) qrColumns.push({ width: 190, ...rightBlock });
          elements.push({ columns: qrColumns, columnGap: 0 });
        }

        return elements;
      })() : []),

      // ── PAYMENT HISTORY ───────────────────────────────────────────────────────
      ...(payments.length > 0 ? [
        sectionTitle('Payment History'),
        {
          table: {
            headerRows: 1,
            widths: [24, 72, 72, '*', 84],
            body: paymentHistoryBody,
          },
          layout: {
            hLineWidth: (i) => (i === 0 || i === 1 ? 0 : 0.5),
            vLineWidth: () => 0,
            hLineColor: () => BORDER,
            paddingLeft:  () => 8,
            paddingRight: () => 8,
            paddingTop:   () => 4,
            paddingBottom:() => 4,
            fillColor: (i) => i === 0 ? ACCENT : null,
          },
        },
        {
          columns: [
            { width: '*', text: '' },
            {
              width: 'auto',
              stack: [
                { text: '', margin: [0, 4] },
                {
                  columns: [
                    { text: 'Total Paid', fontSize: 8, color: MUTED, margin: [0, 0, 14, 0] },
                    { text: formatCurrency(totalPaid), fontSize: 8, bold: true, color: SUCCESS },
                  ],
                },
                {
                  columns: [
                    { text: 'Balance Due', fontSize: 8, color: MUTED, margin: [0, 3, 14, 0] },
                    {
                      text: formatCurrency(balanceDue),
                      fontSize: 8, bold: true,
                      color: balanceDue <= 0 ? SUCCESS : DANGER,
                      margin: [0, 3, 0, 0],
                    },
                  ],
                },
              ],
            },
          ],
          margin: [0, 5, 0, 0],
        },
      ] : []),

      // ── FOOTER NOTE ───────────────────────────────────────────────────────────
      { text: '', margin: [0, 14] },
      divider(BORDER, 0.5),
      {
        text: 'Thank you for your business!',
        fontSize: 8, color: LIGHT, alignment: 'center', italics: true, margin: [0, 8, 0, 0],
      },
    ],

    styles: {
      orgName:      { fontSize: 15, bold: true, color: DARK },
      orgMeta:      { fontSize: 8, color: MUTED, margin: [0, 1.5, 0, 0] },
      invoiceLabel: { fontSize: 22, bold: true, color: ACCENT },
      blockLabel:   { fontSize: 7, bold: true, color: LIGHT, characterSpacing: 1.5 },
      thCell:       { bold: true, color: WHITE, fontSize: 8, margin: [0, 6, 0, 6] },
    },
    defaultStyle: { fontSize: 9, color: MID, font: 'Roboto' },
  };

  return generatePdfBuffer(docDefinition);
};

/**
 * Generate a payment receipt PDF for a single payment.
 * @param {Object} invoiceData
 * @param {Object} orgData
 * @param {Object} clientData
 * @param {Object} paymentData
 * @returns {Buffer}
 */
export const generateReceiptPdf = async (invoiceData, orgData, clientData, paymentData) => {
  const [orgLogoUri, clientLogoUri] = await Promise.all([
    fetchImageAsDataUri(orgData.logo),
    fetchImageAsDataUri(clientData.logo),
  ]);

  const payments = invoiceData.payments || [];
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const balanceDue = Math.max(invoiceData.total - totalPaid, 0);

  const orgHeaderStack = [];
  if (orgLogoUri) orgHeaderStack.push({ image: orgLogoUri, width: 50, height: 50, margin: [0, 0, 0, 6] });
  orgHeaderStack.push({ text: orgData.name, fontSize: 15, bold: true, color: DARK });
  if (orgData.address?.city) orgHeaderStack.push({ text: [orgData.address.city, orgData.address.state].filter(Boolean).join(', '), fontSize: 8.5, color: MUTED, margin: [0, 2, 0, 0] });
  if (orgData.phone) orgHeaderStack.push({ text: orgData.phone, fontSize: 8.5, color: MUTED, margin: [0, 1, 0, 0] });

  const docDefinition = {
    pageSize: 'A4',
    pageMargins: [44, 44, 44, 64],

    footer: (currentPage, pageCount) => ({
      columns: [
        { text: orgData.name, fontSize: 7.5, color: LIGHT, margin: [44, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7.5, color: LIGHT, alignment: 'right', margin: [0, 0, 44, 0] },
      ],
      margin: [0, 14, 0, 0],
    }),

    content: [
      // Top band — green
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 6, r: 0, color: SUCCESS }], margin: [0, 0, 0, 24] },

      // Header
      {
        columns: [
          { width: '55%', stack: orgHeaderStack },
          {
            width: '45%',
            stack: [
              { text: 'PAYMENT RECEIPT', fontSize: 17, bold: true, color: SUCCESS, alignment: 'right' },
              { text: '', margin: [0, 8] },
              {
                canvas: [{ type: 'rect', x: 0, y: 0, w: 220, h: 56, r: 6, color: SUCCESS_BG }],
                margin: [0, 0, 0, -56],
              },
              {
                stack: [
                  { columns: [{ text: 'Receipt For', width: '*', alignment: 'right', color: MUTED, fontSize: 8.5, margin: [0, 10, 12, 0] }, { text: invoiceData.invoiceNumber, width: 'auto', alignment: 'right', bold: true, fontSize: 8.5, color: DARK, margin: [0, 10, 12, 0] }] },
                  { columns: [{ text: 'Payment Date', width: '*', alignment: 'right', color: MUTED, fontSize: 8.5, margin: [0, 5, 12, 10] }, { text: formatDate(paymentData.date), width: 'auto', alignment: 'right', bold: true, fontSize: 8.5, color: DARK, margin: [0, 5, 12, 10] }] },
                ],
              },
            ],
          },
        ],
      },

      { text: '', margin: [0, 18] },
      divider(SUCCESS, 1.5),
      { text: '', margin: [0, 16] },

      // From / Received From
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'FROM', style: 'blockLabel' },
              { text: '', margin: [0, 3] },
              ...(orgLogoUri ? [{ image: orgLogoUri, width: 32, height: 32, margin: [0, 0, 0, 4] }] : []),
              { text: orgData.name, bold: true, fontSize: 10, color: DARK },
            ],
          },
          {
            width: '50%',
            stack: [
              { text: 'RECEIVED FROM', style: 'blockLabel', alignment: 'right' },
              { text: '', margin: [0, 3] },
              ...(clientLogoUri ? [{ image: clientLogoUri, width: 32, height: 32, margin: [0, 0, 0, 4], alignment: 'right' }] : []),
              { text: clientData.name, bold: true, fontSize: 10, color: DARK, alignment: 'right' },
              ...(clientData.companyName ? [{ text: clientData.companyName, fontSize: 8.5, color: MID, alignment: 'right', italics: true, margin: [0, 1, 0, 0] }] : []),
              ...(clientData.email ? [{ text: clientData.email, fontSize: 8.5, color: MID, alignment: 'right', margin: [0, 1, 0, 0] }] : []),
            ],
          },
        ],
      },

      { text: '', margin: [0, 20] },

      // Payment amount box
      { canvas: [{ type: 'rect', x: 0, y: 0, w: 515, h: 96, r: 8, color: SUCCESS_BG }], margin: [0, 0, 0, -96] },
      {
        stack: [
          { text: 'AMOUNT RECEIVED', fontSize: 8, bold: true, color: SUCCESS, characterSpacing: 1.5, margin: [20, 14, 0, 4] },
          { text: formatCurrency(paymentData.amount), fontSize: 30, bold: true, color: SUCCESS, margin: [20, 0, 0, 0] },
          {
            columns: [
              { text: `Method: ${(paymentData.method || 'other').replace(/_/g, ' ')}`, fontSize: 8.5, color: MID, margin: [20, 6, 0, 14] },
              ...(paymentData.reference ? [{ text: `Ref: ${paymentData.reference}`, fontSize: 8.5, color: MID, alignment: 'right', margin: [0, 6, 20, 14] }] : []),
            ],
          },
        ],
      },

      { text: '', margin: [0, 16] },

      sectionTitle('Invoice Summary', SUCCESS),
      {
        columns: [
          { width: '*', text: '' },
          {
            width: 240,
            stack: [
              divider(BORDER, 0.5),
              { columns: [{ text: 'Invoice Total', width: '*', color: MUTED, fontSize: 8.5, margin: [0, 7, 0, 0] }, { text: formatCurrency(invoiceData.total), alignment: 'right', fontSize: 8.5, color: MID, margin: [0, 7, 0, 0] }] },
              { columns: [{ text: 'This Payment', width: '*', color: MUTED, fontSize: 8.5, margin: [0, 4, 0, 0] }, { text: formatCurrency(paymentData.amount), alignment: 'right', fontSize: 8.5, bold: true, color: SUCCESS, margin: [0, 4, 0, 0] }] },
              { columns: [{ text: 'Total Paid (all)', width: '*', color: MUTED, fontSize: 8.5, margin: [0, 4, 0, 0] }, { text: formatCurrency(totalPaid), alignment: 'right', fontSize: 8.5, color: MID, margin: [0, 4, 0, 0] }] },
              { text: '', margin: [0, 7] },
              { canvas: [{ type: 'rect', x: 0, y: 0, w: 240, h: 38, r: 5, color: balanceDue === 0 ? SUCCESS : DANGER }] },
              { columns: [{ text: 'BALANCE DUE', fontSize: 10, bold: true, color: WHITE, margin: [12, -32, 0, 0] }, { text: formatCurrency(balanceDue), alignment: 'right', fontSize: 14, bold: true, color: WHITE, margin: [0, -32, 12, 0] }] },
              { text: '', margin: [0, 8] },
            ],
          },
        ],
      },

      { text: '', margin: [0, 24] },
      divider(BORDER, 0.5),
      {
        text: balanceDue === 0 ? 'Invoice fully paid. Thank you!' : 'Thank you for your payment!',
        fontSize: 8.5, color: LIGHT, alignment: 'center', italics: true, margin: [0, 10, 0, 0],
      },
    ],

    styles: {
      blockLabel: { fontSize: 7.5, bold: true, color: LIGHT, characterSpacing: 1.5 },
      thCell:     { bold: true, color: WHITE, fontSize: 8.5, margin: [0, 7, 0, 7] },
    },
    defaultStyle: { fontSize: 9.5, color: MID, font: 'Roboto' },
  };

  return generatePdfBuffer(docDefinition);
};

/**
 * Generate a meeting notes PDF.
 * @param {Object} meetingData - the meeting document (populated)
 * @returns {Buffer}
 */
export const generateMeetingNotesPdf = async (meetingData) => {
  const attendeeList = (meetingData.attendees || []).map((a) => ({
    text: `${a.name || a.email} (${a.type})`,
    margin: [10, 2, 0, 0],
  }));

  const docDefinition = {
    content: [
      { text: 'Meeting Notes', style: 'header' },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1, lineColor: '#4472C4' }] },
      { text: '', margin: [0, 10] },
      { text: meetingData.title, style: 'meetingTitle' },
      { text: '', margin: [0, 5] },
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: `Date: ${formatDate(meetingData.scheduledAt)}` },
              { text: `Duration: ${meetingData.duration} minutes` },
              { text: `Status: ${meetingData.status}` },
            ],
          },
          {
            width: '50%',
            stack: [
              meetingData.meetLink
                ? { text: `Meet Link: ${meetingData.meetLink}`, link: meetingData.meetLink, color: '#4472C4' }
                : null,
            ].filter(Boolean),
            alignment: 'right',
          },
        ],
      },
      { text: '', margin: [0, 10] },
      meetingData.description
        ? { stack: [{ text: 'Description', style: 'sectionHeader' }, { text: meetingData.description, margin: [0, 5, 0, 10] }] }
        : null,
      attendeeList.length > 0
        ? { stack: [{ text: 'Attendees', style: 'sectionHeader' }, ...attendeeList, { text: '', margin: [0, 10] }] }
        : null,
      meetingData.notes
        ? { stack: [{ text: 'Notes', style: 'sectionHeader' }, { text: meetingData.notes, margin: [0, 5, 0, 0] }] }
        : null,
    ].filter(Boolean),
    styles: {
      header:        { fontSize: 22, bold: true, color: '#4472C4', alignment: 'center' },
      meetingTitle:  { fontSize: 16, bold: true },
      sectionHeader: { fontSize: 13, bold: true, color: '#4472C4', margin: [0, 5, 0, 5] },
    },
    defaultStyle: { fontSize: 10, font: 'Roboto' },
  };

  return generatePdfBuffer(docDefinition);
};

export default { generateInvoicePdf, generateReceiptPdf, generateMeetingNotesPdf };
