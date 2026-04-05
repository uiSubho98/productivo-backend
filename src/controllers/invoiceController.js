import bcrypt from 'bcryptjs';
import { getSuperadminOrgIds } from '../middleware/auth.js';
import Invoice from '../models/Invoice.js';
import Organization from '../models/Organization.js';
import Client from '../models/Client.js';
import User from '../models/User.js';
import PaymentAccount from '../models/PaymentAccount.js';
import Project from '../models/Project.js';
import { generateInvoiceNumber } from '../utils/helpers.js';
import { generateInvoicePdf, generateReceiptPdf } from '../services/pdfService.js';
import { uploadFile } from '../services/storageService.js';
import { sendEmail } from '../services/emailService.js';
import { sendDocument, sendMessage } from '../services/whatsappService.js';
import { isWhatsappEnabledForOrg } from '../services/whatsappFeatureService.js';

/**
 * Check whether the current user may VIEW invoices.
 * - superadmin: always yes (it's their org)
 * - product_owner: NO — product owner cannot view/manage client invoices
 * - org_admin: only if their org has canViewInvoices = true
 */
async function canUserViewInvoices(user) {
  if (user.role === 'product_owner') return false;
  if (user.role === 'superadmin') return true;
  if (user.role === 'org_admin') {
    const org = await Organization.findById(user.organizationId).select('canViewInvoices');
    return org?.canViewInvoices === true;
  }
  return false;
}

/**
 * Returns the organizationId filter for invoice queries, scoped to the user's
 * allowed org tree. Throws a 403-ready object if not allowed.
 * { organizationId: { $in: [...] } }
 */
async function getInvoiceOrgFilter(user) {
  const orgIds = await getSuperadminOrgIds(user);
  if (!orgIds || orgIds.length === 0) {
    return null;
  }
  return { organizationId: { $in: orgIds } };
}

/**
 * Check whether the current user may CREATE / EDIT / DELETE invoices.
 * - product_owner: NO
 * - superadmin: yes
 * - org_admin: only if canViewInvoices = true (same flag gates both read and write)
 */
async function canUserMutateInvoices(user) {
  if (user.role === 'product_owner') return false;
  return canUserViewInvoices(user);
}

export const create = async (req, res) => {
  try {
    if (!(await canUserMutateInvoices(req.user))) {
      if (req.user.role === 'product_owner') {
        return res.status(403).json({ success: false, error: 'Product owner cannot create invoices.' });
      }
      return res.status(403).json({ success: false, error: 'Invoice access not granted for your organization. Ask your superadmin to enable it.' });
    }

    const { clientId, projectId, items, taxPercentage, notes, paymentAccountIds } = req.body;
    const organizationId = req.user.organizationId;

    if (!organizationId) {
      return res.status(400).json({ success: false, error: 'organizationId is required.' });
    }

    const org = await Organization.findById(organizationId);
    const tax = taxPercentage !== undefined ? taxPercentage : (org?.taxPercentage ?? 18);

    const subtotal = items.reduce((sum, item) => {
      item.amount = item.quantity * item.rate;
      return sum + item.amount;
    }, 0);

    const taxAmount = (subtotal * tax) / 100;
    const total = subtotal + taxAmount;

    const invoiceNumber = await generateInvoiceNumber();

    const invoice = await Invoice.create({
      invoiceNumber,
      organizationId,
      clientId,
      projectId: projectId || null,
      items,
      subtotal,
      taxPercentage: tax,
      taxAmount,
      total,
      notes: notes || '',
      paymentAccountIds: Array.isArray(paymentAccountIds) ? paymentAccountIds.slice(0, 3) : [],
      activityLog: [{ action: 'Created', by: req.user._id }],
    });

    // Notify client about new invoice (fire and forget)
    if (clientId) {
      Client.findById(clientId).then(async (client) => {
        if (!client) return;
        const orgName = org?.name || 'Your Vendor';
        if (client.email) {
          sendEmail(
            client.email,
            `New Invoice ${invoiceNumber} from ${orgName}`,
            `<h3>Invoice ${invoiceNumber}</h3>
            <p>Dear ${client.name},</p>
            <p>A new invoice has been created for you.</p>
            <p><strong>Amount:</strong> ₹${total.toLocaleString('en-IN')}</p>
            <p>You will receive the invoice PDF shortly. For any queries, please contact ${orgName}.</p>
            <br/><p>— ${orgName}</p>`
          ).catch((e) => console.error('[Invoice] Create email error:', e.message));
        }
        if (client.whatsappNumber) {
          const { enabled: waCreateEnabled } = await isWhatsappEnabledForOrg(organizationId).catch(() => ({ enabled: false }));
          if (waCreateEnabled) {
            const phone = client.countryCode
              ? `${client.countryCode}${client.whatsappNumber}`.replace(/^\+\+/, '+')
              : client.whatsappNumber;
            sendMessage(
              phone,
              `New Invoice ${invoiceNumber} from ${orgName}\nAmount: ₹${total.toLocaleString('en-IN')}\nPlease check your email for the invoice PDF.\n\n— ${orgName}`
            ).catch((e) => console.error('[Invoice] Create WA error:', e.message));
          }
        }
      }).catch((e) => console.error('[Invoice] Create notify error:', e.message));
    }

    return res.status(201).json({
      success: true,
      data: invoice,
      message: 'Invoice created.',
    });
  } catch (error) {
    console.error('Create invoice error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create invoice.',
    });
  }
};

export const getAll = async (req, res) => {
  try {
    if (!(await canUserViewInvoices(req.user))) {
      if (req.user.role === 'product_owner') {
        return res.status(403).json({ success: false, error: 'Product owner cannot access client invoices.' });
      }
      return res.status(403).json({ success: false, error: 'Invoice access not granted for your organization.' });
    }

    const { clientId, status, search, page = 1, limit = 15 } = req.query;
    const invoiceOrgIds = await getSuperadminOrgIds(req.user);
    if (!invoiceOrgIds || invoiceOrgIds.length === 0) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const filter = { organizationId: { $in: invoiceOrgIds } };

    if (clientId) filter.clientId = clientId;
    if (status) filter.status = status;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 15));
    const skip = (pageNum - 1) * limitNum;

    // Build base query; if search is provided we do a post-populate filter via aggregation-style
    // For simplicity we fetch with populate then filter in JS for the search term
    let query = Invoice.find(filter)
      .populate('clientId', 'name email')
      .populate('projectId', 'name')
      .populate('organizationId', 'name logo')
      .sort({ createdAt: -1 });

    if (!search) {
      const [invoices, total] = await Promise.all([
        query.skip(skip).limit(limitNum),
        Invoice.countDocuments(filter),
      ]);
      return res.status(200).json({
        success: true,
        data: invoices,
        pagination: { total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum) },
      });
    }

    // With search: fetch all matching org/status docs, filter by invoiceNumber/client name/project name
    const allInvoices = await query;
    const q = search.toLowerCase();
    const matched = allInvoices.filter(
      (inv) =>
        (inv.invoiceNumber || '').toLowerCase().includes(q) ||
        (inv.clientId?.name || '').toLowerCase().includes(q) ||
        (inv.projectId?.name || '').toLowerCase().includes(q)
    );
    const paginated = matched.slice(skip, skip + limitNum);
    return res.status(200).json({
      success: true,
      data: paginated,
      pagination: { total: matched.length, page: pageNum, limit: limitNum, pages: Math.ceil(matched.length / limitNum) },
    });
  } catch (error) {
    console.error('Get invoices error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch invoices.',
    });
  }
};

export const getById = async (req, res) => {
  try {
    if (!(await canUserViewInvoices(req.user))) {
      if (req.user.role === 'product_owner') {
        return res.status(403).json({ success: false, error: 'Product owner cannot access client invoices.' });
      }
      return res.status(403).json({ success: false, error: 'Invoice access not granted for your organization.' });
    }

    const invoiceByIdOrgIds = await getSuperadminOrgIds(req.user);
    if (!invoiceByIdOrgIds || invoiceByIdOrgIds.length === 0) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const invoice = await Invoice.findOne({ _id: req.params.id, organizationId: { $in: invoiceByIdOrgIds } })
      .populate('clientId', 'name email phoneNumber whatsappNumber address')
      .populate('organizationId', 'name cinNumber taxPercentage address email phone logo')
      .populate('paymentAccountIds', 'accountName type bankName accountNumber ifscCode accountHolderName upiId qrImageUrl isDefault')
      .populate('projectId', 'name')
      .populate('activityLog.by', 'name')
      .populate('payments.recordedBy', 'name');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: invoice,
    });
  } catch (error) {
    console.error('Get invoice error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch invoice.',
    });
  }
};

export const update = async (req, res) => {
  try {
    if (!(await canUserMutateInvoices(req.user))) {
      return res.status(403).json({ success: false, error: req.user.role === 'product_owner' ? 'Product owner cannot modify invoices.' : 'Invoice access not granted for your organization.' });
    }
    const { items, taxPercentage, notes, status, paymentAccountIds } = req.body;
    const updateData = {};

    if (items !== undefined) {
      const subtotal = items.reduce((sum, item) => {
        item.amount = item.quantity * item.rate;
        return sum + item.amount;
      }, 0);

      const existingInvoice = await Invoice.findById(req.params.id).select('taxPercentage');
      const tax = taxPercentage !== undefined ? taxPercentage : (existingInvoice?.taxPercentage ?? 0);
      const taxAmount = (subtotal * tax) / 100;
      const total = subtotal + taxAmount;

      updateData.items = items;
      updateData.subtotal = subtotal;
      updateData.taxPercentage = tax;
      updateData.taxAmount = taxAmount;
      updateData.total = total;
    }

    if (notes !== undefined) updateData.notes = notes;
    if (status !== undefined) updateData.status = status;
    if (paymentAccountIds !== undefined) updateData.paymentAccountIds = Array.isArray(paymentAccountIds) ? paymentAccountIds.slice(0, 3) : [];
    if (taxPercentage !== undefined && !items) {
      // Recalculate totals using existing subtotal
      const existing = await Invoice.findById(req.params.id).select('subtotal');
      const sub = existing?.subtotal ?? 0;
      updateData.taxPercentage = taxPercentage;
      updateData.taxAmount = (sub * taxPercentage) / 100;
      updateData.total = sub + updateData.taxAmount;
    }

    // Clear cached PDF whenever financials change so next download regenerates it
    if (items !== undefined || taxPercentage !== undefined) updateData.pdfUrl = null;

    const logEntry = { action: status ? `Status changed to ${status}` : 'Invoice edited', by: req.user._id };
    updateData.$push = { activityLog: logEntry };

    const updateOrgFilter = await getInvoiceOrgFilter(req.user);
    if (!updateOrgFilter) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const invoice = await Invoice.findOneAndUpdate(
      { _id: req.params.id, ...updateOrgFilter },
      updateData,
      { new: true, runValidators: true }
    )
      .populate('clientId', 'name email phoneNumber whatsappNumber address')
      .populate('organizationId', 'name cinNumber taxPercentage address email phone logo')
      .populate('activityLog.by', 'name')
      .populate('payments.recordedBy', 'name');

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: invoice,
      message: 'Invoice updated.',
    });
  } catch (error) {
    console.error('Update invoice error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update invoice.',
    });
  }
};

export const generatePdf = async (req, res) => {
  try {
    if (!(await canUserViewInvoices(req.user))) {
      return res.status(403).json({ success: false, error: req.user.role === 'product_owner' ? 'Product owner cannot access invoices.' : 'Invoice access not granted for your organization.' });
    }
    const pdfOrgFilter = await getInvoiceOrgFilter(req.user);
    if (!pdfOrgFilter) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const invoice = await Invoice.findOne({ _id: req.params.id, ...pdfOrgFilter });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found.',
      });
    }

    const org = await Organization.findById(invoice.organizationId);
    const client = await Client.findById(invoice.clientId);

    // Fetch payment account details for PDF
    let paymentAccounts = [];
    if (invoice.paymentAccountIds?.length) {
      paymentAccounts = await PaymentAccount.find({ _id: { $in: invoice.paymentAccountIds } });
    }
    if (!paymentAccounts.length) {
      paymentAccounts = await PaymentAccount.find({ organizationId: invoice.organizationId, isActive: true });
    }

    let project = null;
    if (invoice.projectId) {
      project = await Project.findById(invoice.projectId).select('name');
    }

    const pdfData = {
      ...invoice.toObject(),
      paymentAccounts: paymentAccounts.map((a) => a.toObject()),
      project: project ? { name: project.name } : null,
    };

    const pdfBuffer = await generateInvoicePdf(pdfData, org.toObject(), client.toObject());

    const { url } = await uploadFile(
      pdfBuffer,
      `${invoice.invoiceNumber}.pdf`,
      'application/pdf',
      'invoices'
    );

    invoice.pdfUrl = url;
    await invoice.save();

    return res.status(200).json({
      success: true,
      data: { pdfUrl: url },
      message: 'Invoice PDF generated.',
    });
  } catch (error) {
    console.error('Generate invoice PDF error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate invoice PDF.',
    });
  }
};

export const sendInvoice = async (req, res) => {
  try {
    if (!(await canUserMutateInvoices(req.user))) {
      return res.status(403).json({ success: false, error: req.user.role === 'product_owner' ? 'Product owner cannot send invoices.' : 'Invoice access not granted for your organization.' });
    }
    const { ccEmails: requestCcEmails } = req.body || {};

    const sendOrgFilter = await getInvoiceOrgFilter(req.user);
    if (!sendOrgFilter) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const invoice = await Invoice.findOne({ _id: req.params.id, ...sendOrgFilter });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found.',
      });
    }

    const client = await Client.findById(invoice.clientId);
    const org = await Organization.findById(invoice.organizationId);

    // Fetch payment account details for the email body
    let paymentAccounts = [];
    if (invoice.paymentAccountIds?.length) {
      paymentAccounts = await PaymentAccount.find({ _id: { $in: invoice.paymentAccountIds } });
    }
    if (!paymentAccounts.length) {
      paymentAccounts = await PaymentAccount.find({ organizationId: invoice.organizationId, isActive: true });
    }

    // Always regenerate PDF to reflect latest invoice and org data
    {
      let project = null;
      if (invoice.projectId) {
        project = await Project.findById(invoice.projectId).select('name');
      }
      const pdfData = {
        ...invoice.toObject(),
        paymentAccounts: paymentAccounts.map((a) => a.toObject()),
        project: project ? { name: project.name } : null,
      };

      const pdfBuffer = await generateInvoicePdf(
        pdfData,
        org.toObject(),
        client.toObject()
      );

      const { url } = await uploadFile(
        pdfBuffer,
        `${invoice.invoiceNumber}.pdf`,
        'application/pdf',
        'invoices'
      );

      invoice.pdfUrl = url;
      await invoice.save();
    }

    // Collect CC emails: request body + superadmin (org-scoped) + product_owner emails
    const superadmins = await User.find({
      $or: [
        { role: 'product_owner', isActive: true },
        { role: 'superadmin', organizationId: invoice.organizationId, isActive: true },
      ],
    }).select('email');
    const superadminEmails = superadmins.map((sa) => sa.email);
    const allCcEmails = [
      ...(requestCcEmails || []),
      ...superadminEmails,
    ].filter((e, i, arr) => e && arr.indexOf(e) === i && e !== client.email);

    const sentVia = [];
    const results = { email: null, whatsapp: null };

    if (client.email) {
      // Build payment details section for email
      let paymentDetailsHtml = '';
      if (paymentAccounts.length) {
        const accountBlocks = paymentAccounts.map((pa) => {
          if (pa.type === 'upi' || pa.type === 'qr') {
            return `<div style="margin-bottom:8px">
              <strong>${pa.accountName || 'UPI'}</strong><br/>
              <strong>UPI ID:</strong> ${pa.upiId || ''}
              ${pa.accountHolderName ? `<br/><strong>Account Holder:</strong> ${pa.accountHolderName}` : ''}
            </div>`;
          } else if (pa.type === 'bank') {
            return `<div style="margin-bottom:8px">
              <strong>${pa.accountName || 'Bank Account'}</strong><br/>
              ${pa.bankName ? `<strong>Bank:</strong> ${pa.bankName}<br/>` : ''}
              ${pa.accountNumber ? `<strong>Account Number:</strong> ${pa.accountNumber}<br/>` : ''}
              ${pa.ifscCode ? `<strong>IFSC Code:</strong> ${pa.ifscCode}<br/>` : ''}
              ${pa.accountHolderName ? `<strong>Account Holder:</strong> ${pa.accountHolderName}` : ''}
            </div>`;
          }
          return '';
        }).join('');
        paymentDetailsHtml = `<h3>Payment Details</h3>${accountBlocks}`;
      }

      // Send one email to the client with CC list included natively
      results.email = await sendEmail(
        client.email,
        `Invoice ${invoice.invoiceNumber} from ${org.name}`,
        `
          <h2>Invoice ${invoice.invoiceNumber}</h2>
          <p>Dear ${client.name},</p>
          <p>Please find your invoice attached. The total amount is <strong>₹${invoice.total.toLocaleString('en-IN')}</strong>.</p>
          <p>You can view/download the invoice <a href="${invoice.pdfUrl}">here</a>.</p>
          ${paymentDetailsHtml}
          <br/>
          <p>Best regards,<br/>${org.name}</p>
        `,
        [],
        allCcEmails,
      );

      sentVia.push('email');
    }

    if (client.whatsappNumber) {
      const { enabled: waSendEnabled } = await isWhatsappEnabledForOrg(invoice.organizationId).catch(() => ({ enabled: false }));
      if (waSendEnabled) {
        const whatsappNumber = client.countryCode
          ? `${client.countryCode}${client.whatsappNumber}`.replace(/^\+\+/, '+')
          : client.whatsappNumber;

        results.whatsapp = await sendDocument(
          whatsappNumber,
          invoice.pdfUrl,
          `Invoice ${invoice.invoiceNumber} from ${org.name} - Total: ${invoice.total}`
        );
        sentVia.push('whatsapp');
      }
    }

    invoice.status = 'sent';
    invoice.sentVia = sentVia;
    invoice.sentAt = new Date();
    invoice.ccEmails = allCcEmails;
    await invoice.save();

    return res.status(200).json({
      success: true,
      data: results,
      message: 'Invoice sent.',
    });
  } catch (error) {
    console.error('Send invoice error:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to send invoice.',
    });
  }
};

export const downloadInvoice = async (req, res) => {
  try {
    if (!(await canUserViewInvoices(req.user))) {
      return res.status(403).json({ success: false, error: req.user.role === 'product_owner' ? 'Product owner cannot access invoices.' : 'Invoice access not granted for your organization.' });
    }
    const downloadOrgFilter = await getInvoiceOrgFilter(req.user);
    if (!downloadOrgFilter) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const invoice = await Invoice.findOne({ _id: req.params.id, ...downloadOrgFilter });

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found.' });
    }

    const org = await Organization.findById(invoice.organizationId);
    const client = await Client.findById(invoice.clientId);

    let paymentAccounts = [];
    if (invoice.paymentAccountIds?.length) {
      paymentAccounts = await PaymentAccount.find({ _id: { $in: invoice.paymentAccountIds } });
    }
    if (!paymentAccounts.length) {
      paymentAccounts = await PaymentAccount.find({ organizationId: invoice.organizationId, isActive: true });
    }

    let project = null;
    if (invoice.projectId) {
      project = await Project.findById(invoice.projectId).select('name');
    }

    const pdfData = {
      ...invoice.toObject(),
      paymentAccounts: paymentAccounts.map((a) => a.toObject()),
      project: project ? { name: project.name } : null,
    };

    const pdfBuffer = await generateInvoicePdf(pdfData, org.toObject(), client.toObject());

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.invoiceNumber}.pdf"`,
      'Content-Length': pdfBuffer.length,
    });
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Download invoice error:', error);
    return res.status(500).json({ success: false, error: 'Failed to download invoice.' });
  }
};

export const downloadReceipt = async (req, res) => {
  try {
    if (!(await canUserViewInvoices(req.user))) {
      return res.status(403).json({ success: false, error: req.user.role === 'product_owner' ? 'Product owner cannot access invoices.' : 'Invoice access not granted for your organization.' });
    }
    const receiptOrgFilter = await getInvoiceOrgFilter(req.user);
    if (!receiptOrgFilter) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const invoice = await Invoice.findOne({ _id: req.params.id, ...receiptOrgFilter });

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found.' });
    }

    const payments = invoice.payments || [];
    if (payments.length === 0) {
      return res.status(400).json({ success: false, error: 'No payments recorded for this invoice.' });
    }

    // Use latest payment by default, or specific one via ?paymentId=
    const { paymentId } = req.query;
    const payment = paymentId
      ? payments.find((p) => p._id.toString() === paymentId)
      : payments[payments.length - 1];

    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found.' });
    }

    const org = await Organization.findById(invoice.organizationId);
    const client = await Client.findById(invoice.clientId);

    const pdfBuffer = await generateReceiptPdf(
      invoice.toObject(),
      org.toObject(),
      client.toObject(),
      payment
    );

    const filename = `Receipt-${invoice.invoiceNumber}-${payment._id.toString().slice(-6)}.pdf`;
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdfBuffer.length,
    });
    return res.send(pdfBuffer);
  } catch (error) {
    console.error('Download receipt error:', error);
    return res.status(500).json({ success: false, error: 'Failed to download receipt.' });
  }
};

export const addPayment = async (req, res) => {
  try {
    if (!(await canUserMutateInvoices(req.user))) {
      return res.status(403).json({ success: false, error: req.user.role === 'product_owner' ? 'Product owner cannot record payments.' : 'Invoice access not granted for your organization.' });
    }
    const { amount, date, method, reference, notes } = req.body;

    if (!amount || !date) {
      return res.status(400).json({
        success: false,
        error: 'Amount and date are required.',
      });
    }

    const paymentOrgFilter = await getInvoiceOrgFilter(req.user);
    if (!paymentOrgFilter) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const invoice = await Invoice.findOne({ _id: req.params.id, ...paymentOrgFilter });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found.',
      });
    }

    const alreadyPaid = invoice.payments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const balanceDue = (invoice.total || 0) - alreadyPaid;
    if (parseFloat(amount) > balanceDue + 0.001) {
      return res.status(400).json({
        success: false,
        error: `Payment amount (₹${parseFloat(amount).toLocaleString('en-IN')}) exceeds balance due (₹${balanceDue.toLocaleString('en-IN')}).`,
      });
    }

    invoice.payments.push({
      amount,
      date,
      method,
      reference,
      notes,
      recordedBy: req.user._id,
      createdAt: new Date(),
    });

    // Recalculate payment status
    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    if (totalPaid >= invoice.total) {
      invoice.paymentStatus = 'paid';
    } else if (totalPaid > 0) {
      invoice.paymentStatus = 'partial';
    } else {
      invoice.paymentStatus = 'unpaid';
    }

    invoice.activityLog.push({
      action: `Payment of ₹${amount} recorded via ${method || 'other'}`,
      by: req.user._id,
    });

    // Invalidate cached PDF so next download reflects updated payment data
    invoice.pdfUrl = null;

    await invoice.save();

    // Auto-provision workspace when invoice is fully paid for the first time
    if (invoice.paymentStatus === 'paid' && !invoice.workspaceProvisioned) {
      provisionWorkspace(invoice).catch((e) =>
        console.error('[Invoice] Workspace provisioning error:', e.message)
      );
    }

    // Notify client about payment receipt (fire and forget)
    Client.findById(invoice.clientId).then(async (client) => {
      if (!client) return;
      const org = await Organization.findById(invoice.organizationId);
      const orgName = org?.name || 'Your Vendor';
      const remaining = Math.max(invoice.total - totalPaid, 0);
      if (client.email) {
        sendEmail(
          client.email,
          `Payment Received – Invoice ${invoice.invoiceNumber}`,
          `<h3>Payment Confirmation</h3>
          <p>Dear ${client.name},</p>
          <p>We have received your payment of <strong>₹${amount.toLocaleString('en-IN')}</strong> for Invoice ${invoice.invoiceNumber}.</p>
          ${remaining > 0
            ? `<p>Remaining balance: <strong>₹${remaining.toLocaleString('en-IN')}</strong></p>`
            : `<p>Your invoice is now <strong>fully paid</strong>. Thank you!</p>`
          }
          <br/><p>— ${orgName}</p>`
        ).catch((e) => console.error('[Invoice] Payment email error:', e.message));
      }
      if (client.whatsappNumber) {
        const { enabled: waPayEnabled } = await isWhatsappEnabledForOrg(invoice.organizationId).catch(() => ({ enabled: false }));
        if (waPayEnabled) {
          const phone = client.countryCode
            ? `${client.countryCode}${client.whatsappNumber}`.replace(/^\+\+/, '+')
            : client.whatsappNumber;
          sendMessage(
            phone,
            `Payment Received ✓\nInvoice: ${invoice.invoiceNumber}\nAmount Paid: ₹${amount.toLocaleString('en-IN')}${remaining > 0 ? `\nBalance Due: ₹${remaining.toLocaleString('en-IN')}` : '\nFully Paid - Thank you!'}\n\n— ${orgName}`
          ).catch((e) => console.error('[Invoice] Payment WA error:', e.message));
        }
      }
    }).catch((e) => console.error('[Invoice] Payment notify error:', e.message));

    return res.status(201).json({
      success: true,
      data: invoice,
      message: 'Payment recorded.',
    });
  } catch (error) {
    console.error('Add payment error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add payment.',
    });
  }
};

export const reviseInvoice = async (req, res) => {
  try {
    if (!(await canUserMutateInvoices(req.user))) {
      return res.status(403).json({ success: false, error: req.user.role === 'product_owner' ? 'Product owner cannot revise invoices.' : 'Invoice access not granted for your organization.' });
    }
    const reviseOrgFilter = await getInvoiceOrgFilter(req.user);
    if (!reviseOrgFilter) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const original = await Invoice.findOne({ _id: req.params.id, ...reviseOrgFilter });

    if (!original) {
      return res.status(404).json({ success: false, error: 'Invoice not found.' });
    }

    if (original.status === 'draft') {
      return res.status(400).json({ success: false, error: 'Draft invoices can be edited directly.' });
    }

    if (original.status === 'cancelled') {
      return res.status(400).json({ success: false, error: 'Cancelled invoices cannot be revised.' });
    }

    // Determine next version: find the highest existing version for this invoice chain
    // The root invoice number is either original.invoiceNumber (if v1) or strip the -vN suffix
    const rootNumber = original.invoiceNumber.replace(/-v\d+$/, '');
    const nextVersion = (original.version || 1) + 1;
    const newInvoiceNumber = `${rootNumber}-v${nextVersion}`;

    // Check for duplicate (shouldn't happen, but guard)
    const existing = await Invoice.findOne({ invoiceNumber: newInvoiceNumber });
    if (existing) {
      return res.status(409).json({ success: false, error: 'A revision with this version already exists.' });
    }

    // Use provided items/notes/tax or copy from original
    const { items: newItems, notes: newNotes, taxPercentage: newTax } = req.body;

    const items = newItems || original.items.map((i) => ({
      description: i.description,
      quantity: i.quantity,
      rate: i.rate,
      amount: i.amount,
    }));

    const taxPercentage = newTax !== undefined ? newTax : (original.taxPercentage ?? 0);
    const subtotal = items.reduce((sum, item) => {
      item.amount = (item.quantity || 1) * (item.rate || 0);
      return sum + item.amount;
    }, 0);
    const taxAmount = (subtotal * taxPercentage) / 100;
    const total = subtotal + taxAmount;

    const revised = await Invoice.create({
      invoiceNumber: newInvoiceNumber,
      organizationId: original.organizationId,
      clientId: original.clientId,
      paymentAccountId: original.paymentAccountId,
      items,
      subtotal,
      taxPercentage,
      taxAmount,
      total,
      notes: newNotes !== undefined ? newNotes : original.notes,
      status: 'draft',
      version: nextVersion,
      revisedFromId: original._id,
      activityLog: [{ action: `Revised from ${original.invoiceNumber}`, by: req.user._id }],
    });

    // Mark original as cancelled with a note
    original.status = 'cancelled';
    original.activityLog.push({ action: `Superseded by ${newInvoiceNumber}`, by: req.user._id });
    await original.save();

    // Populate for response
    const populated = await Invoice.findById(revised._id)
      .populate('clientId', 'name email phoneNumber whatsappNumber address')
      .populate('organizationId', 'name cinNumber taxPercentage address email phone logo')
      .populate('activityLog.by', 'name');

    return res.status(201).json({ success: true, data: populated, message: `Invoice revised as ${newInvoiceNumber}.` });
  } catch (error) {
    console.error('Revise invoice error:', error);
    return res.status(500).json({ success: false, error: 'Failed to revise invoice.' });
  }
};

export const updatePayment = async (req, res) => {
  try {
    if (!(await canUserMutateInvoices(req.user))) {
      return res.status(403).json({ success: false, error: req.user.role === 'product_owner' ? 'Product owner cannot modify payments.' : 'Invoice access not granted for your organization.' });
    }
    const { amount, date, method, reference, notes } = req.body;

    const updatePaymentOrgFilter = await getInvoiceOrgFilter(req.user);
    if (!updatePaymentOrgFilter) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const invoice = await Invoice.findOne({ _id: req.params.id, ...updatePaymentOrgFilter });

    if (!invoice) {
      return res.status(404).json({ success: false, error: 'Invoice not found.' });
    }

    const payment = invoice.payments.id(req.params.paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found.' });
    }

    // Build a human-readable diff for the activity log
    const changes = [];
    if (amount !== undefined && amount !== payment.amount) changes.push(`amount ₹${payment.amount} → ₹${amount}`);
    if (method !== undefined && method !== payment.method) changes.push(`method ${payment.method} → ${method}`);
    if (reference !== undefined && reference !== payment.reference) changes.push(`reference updated`);
    if (notes !== undefined && notes !== payment.notes) changes.push(`notes updated`);

    // Apply edits
    if (amount !== undefined) payment.amount = amount;
    if (date !== undefined) payment.date = date;
    if (method !== undefined) payment.method = method;
    if (reference !== undefined) payment.reference = reference;
    if (notes !== undefined) payment.notes = notes;
    payment.updatedAt = new Date();
    payment.updatedBy = req.user._id;

    // Recalculate payment status
    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    invoice.paymentStatus = totalPaid >= invoice.total ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';

    // Log the edit
    const logText = changes.length
      ? `Payment edited: ${changes.join(', ')}`
      : 'Payment record updated';
    invoice.activityLog.push({ action: logText, by: req.user._id });

    invoice.pdfUrl = null;
    await invoice.save();

    const populated = await Invoice.findById(invoice._id)
      .populate('clientId', 'name email phoneNumber whatsappNumber address')
      .populate('organizationId', 'name cinNumber taxPercentage address email phone logo')
      .populate('paymentAccountIds', 'accountName type bankName accountNumber ifscCode accountHolderName upiId qrImageUrl isDefault')
      .populate('projectId', 'name')
      .populate('activityLog.by', 'name')
      .populate('payments.recordedBy', 'name')
      .populate('payments.updatedBy', 'name');

    return res.status(200).json({ success: true, data: populated, message: 'Payment updated.' });
  } catch (error) {
    console.error('Update payment error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update payment.' });
  }
};

export const removePayment = async (req, res) => {
  try {
    if (!(await canUserMutateInvoices(req.user))) {
      return res.status(403).json({ success: false, error: req.user.role === 'product_owner' ? 'Product owner cannot remove payments.' : 'Invoice access not granted for your organization.' });
    }
    const removePaymentOrgFilter = await getInvoiceOrgFilter(req.user);
    if (!removePaymentOrgFilter) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const invoice = await Invoice.findOne({ _id: req.params.id, ...removePaymentOrgFilter });

    if (!invoice) {
      return res.status(404).json({
        success: false,
        error: 'Invoice not found.',
      });
    }

    const payment = invoice.payments.id(req.params.paymentId);
    if (!payment) {
      return res.status(404).json({ success: false, error: 'Payment not found.' });
    }

    const removedAmount = payment.amount;
    const removedMethod = payment.method || 'other';
    invoice.payments.pull(req.params.paymentId);

    // Recalculate payment status
    const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
    invoice.paymentStatus = totalPaid >= invoice.total ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';

    invoice.activityLog.push({
      action: `Payment of ₹${removedAmount} via ${removedMethod} removed`,
      by: req.user._id,
    });
    invoice.pdfUrl = null;

    await invoice.save();

    return res.status(200).json({
      success: true,
      data: invoice,
      message: 'Payment removed.',
    });
  } catch (error) {
    console.error('Remove payment error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to remove payment.',
    });
  }
};

/**
 * Auto-provision a workspace when a client's invoice is fully paid.
 * Creates an Organization + User (org_admin) for the client and sends welcome email.
 * Runs fire-and-forget — does NOT block the payment response.
 */
async function provisionWorkspace(invoice) {
  const client = await Client.findById(invoice.clientId);
  if (!client || !client.email) {
    console.log('[Provision] Skipping: no client or no client email.');
    return;
  }

  // Skip if workspace already exists for this client's email
  const existingUser = await User.findOne({ email: client.email.toLowerCase() });
  if (existingUser) {
    // Just mark as provisioned if user already exists
    await Invoice.findByIdAndUpdate(invoice._id, { workspaceProvisioned: true });
    console.log('[Provision] User already exists for', client.email);
    return;
  }

  // Create organization named after client (or company name)
  const orgName = client.companyName || client.name;
  const org = await Organization.create({
    name: orgName,
    phone: client.phoneNumber || client.whatsappNumber || null,
    address: client.address || undefined,
  });

  // Default password: 123@<email>
  const defaultPassword = `123@${client.email.toLowerCase()}`;
  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(defaultPassword, salt);

  const newUser = await User.create({
    name: client.name,
    email: client.email.toLowerCase(),
    passwordHash,
    role: 'superadmin',
    organizationId: org._id,
    isActive: true,
  });

  // Link user as org admin
  org.adminIds = [newUser._id];
  await org.save();

  // Mark invoice as provisioned
  await Invoice.findByIdAndUpdate(invoice._id, { workspaceProvisioned: true });

  // Send welcome email with credentials
  const appUrl = process.env.APP_URL || 'https://www.productivo.in';
  await sendEmail(
    client.email,
    'Welcome to Productivo — Your Workspace is Ready!',
    `
    <div style="font-family: Inter, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="width: 48px; height: 48px; background: #2563eb; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
          <span style="color: white; font-size: 24px;">⚡</span>
        </div>
        <h1 style="color: #111827; font-size: 22px; font-weight: 700; margin: 0;">Your Workspace is Ready!</h1>
        <p style="color: #6b7280; font-size: 14px; margin-top: 8px;">Your payment has been received. Here are your login credentials.</p>
      </div>
      <div style="background: #f3f4f6; border-radius: 16px; padding: 24px; margin-bottom: 24px;">
        <p style="margin: 0 0 8px 0; color: #374151;"><strong>Organization:</strong> ${orgName}</p>
        <p style="margin: 0 0 8px 0; color: #374151;"><strong>Login Email:</strong> ${client.email}</p>
        <p style="margin: 0; color: #374151;"><strong>Default Password:</strong> <code style="background:#e5e7eb; padding: 2px 6px; border-radius:4px;">${defaultPassword}</code></p>
      </div>
      <p style="color: #6b7280; font-size: 13px; text-align: center;">Please change your password after logging in for the first time.</p>
      <div style="text-align: center; margin-top: 24px;">
        <a href="${appUrl}" style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">Login to Productivo</a>
      </div>
    </div>
    `
  );

  console.log(`[Provision] Workspace created for ${client.email} (org: ${orgName})`);
}
