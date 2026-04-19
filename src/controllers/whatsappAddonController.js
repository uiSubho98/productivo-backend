import WhatsappAddon, { ADDON_FEATURES, ADDON_PRICES } from '../models/WhatsappAddon.js';
import Organization from '../models/Organization.js';
import Invoice from '../models/Invoice.js';
import Task from '../models/Task.js';
import Meeting from '../models/Meeting.js';
import ActivityLog from '../models/ActivityLog.js';
import env from '../config/env.js';
import * as wabridge from '../services/wabridgeService.js';
import { ensureInvoicePdfUrl } from './invoiceController.js';

const INVOICE_DUE_DAYS = 30;

function logSend({ req, feature, to, subject, success, errorMsg, messageId }) {
  const payload = {
    type: 'whatsapp',
    method: 'POST',
    path: req.originalUrl,
    userId: req.user?._id || null,
    userEmail: req.user?.email || null,
    userRole: req.user?.role || null,
    organizationId: req.user?.organizationId || null,
    ip: req.ip,
    to,
    subject: `[${feature}] ${subject || ''}${messageId ? ` · msgId=${messageId}` : ''}`.slice(0, 300),
    success,
    errorMsg: errorMsg || null,
  };
  ActivityLog.create(payload).catch(() => {});
}

async function resolveSuperadminId(req) {
  if (req.user.role === 'superadmin') return req.user._id;
  if (!req.user.organizationId) return null;
  const org = await Organization.findById(req.user.organizationId).select('superadminId').lean();
  return org?.superadminId || null;
}

async function requireFeature(req, feature) {
  const superadminId = await resolveSuperadminId(req);
  if (!superadminId) return { ok: false, status: 403, error: 'No superadmin linked to your org.' };

  const record = await WhatsappAddon.findOne({ superadminId });
  if (!record || !record.isFeatureActive(feature)) {
    return {
      ok: false,
      status: 403,
      error: `WhatsApp ${feature} add-on not active. Purchase it from Premium Features.`,
    };
  }
  return { ok: true, superadminId, record };
}

function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }) + ' IST';
}

// GET /api/v1/whatsapp-addons/logs — addon-send history with filter / search / date / pagination
// Query params:
//   feature  = invoice | task_reminder | meeting_invite  (optional)
//   q        = substring match on recipient or subject   (optional)
//   from, to = ISO date range on createdAt               (optional)
//   page     = 1-based                                   (default 1)
//   limit    = 1..100                                     (default 25)
export const getAddonLogs = async (req, res) => {
  try {
    const superadminId = await resolveSuperadminId(req);
    if (!superadminId) {
      return res.status(200).json({ success: true, data: [], total: 0, page: 1, limit: 0 });
    }
    const org = await Organization.findOne({ superadminId }).select('_id').lean();
    const orgId = org?._id || req.user.organizationId || null;

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    const skip = (page - 1) * limit;

    const filter = { type: 'whatsapp' };
    if (orgId) filter.organizationId = orgId;

    // Feature filter — subject is stored as "[invoice] ..." etc.
    const feature = req.query.feature;
    if (feature && ADDON_FEATURES.includes(feature)) {
      filter.subject = { $regex: `^\\[${feature}\\]`, $options: 'i' };
    }

    // Text search — on subject OR recipient
    const q = (req.query.q || '').toString().trim();
    if (q) {
      const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const search = { $regex: safe, $options: 'i' };
      if (filter.subject) {
        // Combine feature prefix with search — both must match
        filter.$and = [{ subject: filter.subject }, { $or: [{ subject: search }, { to: search }] }];
        delete filter.subject;
      } else {
        filter.$or = [{ subject: search }, { to: search }];
      }
    }

    // Date range
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;
    if ((from && !isNaN(from)) || (to && !isNaN(to))) {
      filter.createdAt = {};
      if (from && !isNaN(from)) filter.createdAt.$gte = from;
      if (to && !isNaN(to)) {
        // Include the whole `to` day
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const [logs, total] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('to subject success errorMsg createdAt userEmail')
        .lean(),
      ActivityLog.countDocuments(filter),
    ]);

    return res.status(200).json({ success: true, data: logs, total, page, limit });
  } catch (err) {
    console.error('getAddonLogs error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load logs.' });
  }
};

// GET /api/v1/whatsapp-addons/me — per-feature status + prices
export const getMyAddons = async (req, res) => {
  try {
    const superadminId = await resolveSuperadminId(req);
    if (!superadminId) {
      return res.status(200).json({
        success: true,
        data: {
          features: Object.fromEntries(ADDON_FEATURES.map((f) => [f, { isActive: false, expiresAt: null }])),
          prices: ADDON_PRICES,
          reason: 'No superadmin linked to your organization.',
        },
      });
    }
    const record = await WhatsappAddon.findOne({ superadminId });
    const status = record ? record.toStatus() : Object.fromEntries(
      ADDON_FEATURES.map((f) => [f, { isActive: false, expiresAt: null }])
    );
    return res.status(200).json({
      success: true,
      data: { features: status, prices: ADDON_PRICES },
    });
  } catch (err) {
    console.error('getMyAddons error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load addon status.' });
  }
};

// POST /api/v1/whatsapp-addons/send-invoice/:invoiceId
// Sends the invoice_template to the invoice's client
export const sendInvoiceViaWhatsapp = async (req, res) => {
  try {
    const guard = await requireFeature(req, 'invoice');
    if (!guard.ok) return res.status(guard.status).json({ success: false, error: guard.error });

    if (!env.wabridgeTemplateInvoice) {
      return res.status(500).json({ success: false, error: 'Invoice template not configured (WABRIDGE_TEMPLATE_INVOICE).' });
    }

    const invoice = await Invoice.findById(req.params.invoiceId)
      .populate('clientId', 'name phoneNumber')
      .populate('projectId', 'name');
    if (!invoice) return res.status(404).json({ success: false, error: 'Invoice not found' });

    const client = invoice.clientId;
    if (!client?.phoneNumber) {
      return res.status(400).json({ success: false, error: 'Client has no phone number.' });
    }

    // Template invoice_template_01 — DOCUMENT header + 3 body variables:
    //   {{1}} = client name           ← Client.name
    //   {{2}} = invoice purpose        ← Invoice.purpose (user-entered), fallback to project/invoice number
    //   {{3}} = due date               ← Invoice.dueDate (user-entered), fallback to createdAt + 30 days
    const purposeText = invoice.purpose?.trim()
      ? invoice.purpose.trim()
      : (invoice.projectId?.name || `invoice #${invoice.invoiceNumber}`);

    const effectiveDueDate = invoice.dueDate
      ? new Date(invoice.dueDate)
      : new Date((invoice.createdAt?.getTime?.() || Date.now()) + INVOICE_DUE_DAYS * 24 * 60 * 60 * 1000);
    const dueDateLabel = effectiveDueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

    const variables = [
      client.name || 'Customer',
      purposeText,
      dueDateLabel,
    ];

    // Ensure a PDF exists on Drive (generates + caches on first send)
    try {
      await ensureInvoicePdfUrl(invoice._id);
    } catch (pdfErr) {
      console.error('ensureInvoicePdfUrl failed:', pdfErr.message);
      return res.status(500).json({
        success: false,
        error: `Could not prepare invoice PDF: ${pdfErr.message}`,
      });
    }

    // Hand Meta/WABridge a URL that ends in .pdf and serves with Content-Type: application/pdf.
    // Our proxy route streams the Drive bytes with proper headers — avoids the Drive
    // "virus scan" HTML redirect which was causing the .BIN-with-no-mime issue.
    const pdfUrl = `${env.publicBaseUrl.replace(/\/$/, '')}/api/v1/public/invoices/${invoice._id}/invoice.pdf`;

    try {
      const result = await wabridge.sendTemplate({
        to: client.phoneNumber,
        templateId: env.wabridgeTemplateInvoice,
        variables,
        media: pdfUrl, // DOCUMENT header
      });
      logSend({
        req,
        feature: 'invoice',
        to: client.phoneNumber,
        subject: `Invoice ${invoice.invoiceNumber} → ${client.name}`,
        success: true,
        messageId: result.messageId,
      });
      return res.status(200).json({ success: true, messageId: result.messageId });
    } catch (sendErr) {
      logSend({
        req,
        feature: 'invoice',
        to: client.phoneNumber,
        subject: `Invoice ${invoice.invoiceNumber} → ${client.name}`,
        success: false,
        errorMsg: sendErr.message,
      });
      throw sendErr;
    }
  } catch (err) {
    console.error('sendInvoiceViaWhatsapp error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/v1/whatsapp-addons/send-task-reminder/:taskId
// Body: { phone?: string } (overrides assignee's stored phone)
export const sendTaskReminderViaWhatsapp = async (req, res) => {
  try {
    const guard = await requireFeature(req, 'task_reminder');
    if (!guard.ok) return res.status(guard.status).json({ success: false, error: guard.error });

    if (!env.wabridgeTemplateTaskReminder) {
      return res.status(400).json({
        success: false,
        error: 'Task reminder template not configured yet. Create it in WABridge and set WABRIDGE_TEMPLATE_TASK_REMINDER.',
      });
    }

    const task = await Task.findById(req.params.taskId)
      .populate('assignees', 'name phoneNumber')
      .populate('projectId', 'name');
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    const primaryAssignee = task.assignees?.[0];
    const phone = (req.body?.phone || primaryAssignee?.phoneNumber || '').toString().trim();
    if (!phone) {
      return res.status(400).json({
        success: false,
        error: 'No phone number available. Assignee has no phone — pass one in the request body.',
      });
    }

    const variables = [
      primaryAssignee?.name || 'there',
      task.title,
      formatDate(task.dueDate) || 'soon',
      task.projectId?.name || '—',
      task.priority || 'medium',
    ];

    try {
      const result = await wabridge.sendTemplate({
        to: phone,
        templateId: env.wabridgeTemplateTaskReminder,
        variables,
      });
      logSend({
        req,
        feature: 'task_reminder',
        to: phone,
        subject: `Task "${task.title}"`,
        success: true,
        messageId: result.messageId,
      });
      return res.status(200).json({ success: true, messageId: result.messageId });
    } catch (sendErr) {
      logSend({
        req,
        feature: 'task_reminder',
        to: phone,
        subject: `Task "${task.title}"`,
        success: false,
        errorMsg: sendErr.message,
      });
      throw sendErr;
    }
  } catch (err) {
    console.error('sendTaskReminderViaWhatsapp error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// POST /api/v1/whatsapp-addons/send-meeting-invite/:meetingId
// Sends meeting_invite template to every attendee with a whatsapp number
export const sendMeetingInviteViaWhatsapp = async (req, res) => {
  try {
    const guard = await requireFeature(req, 'meeting_invite');
    if (!guard.ok) return res.status(guard.status).json({ success: false, error: guard.error });

    if (!env.wabridgeTemplateMeetingInvite) {
      return res.status(400).json({
        success: false,
        error: 'Meeting invite template not configured yet. Create it in WABridge and set WABRIDGE_TEMPLATE_MEETING_INVITE.',
      });
    }

    const meeting = await Meeting.findById(req.params.meetingId);
    if (!meeting) return res.status(404).json({ success: false, error: 'Meeting not found' });

    const recipients = (meeting.attendees || []).filter((a) => a.whatsapp);
    if (!recipients.length) {
      return res.status(400).json({ success: false, error: 'No attendees with a WhatsApp number.' });
    }

    const date = formatDate(meeting.scheduledAt);
    const time = formatTime(meeting.scheduledAt);
    const location = meeting.meetLink || 'See calendar invite';
    const agenda = meeting.description || meeting.title;

    const results = [];
    for (const r of recipients) {
      try {
        const variables = [r.name || 'there', meeting.title, date, time, location, agenda];
        const out = await wabridge.sendTemplate({
          to: r.whatsapp,
          templateId: env.wabridgeTemplateMeetingInvite,
          variables,
        });
        results.push({ to: r.whatsapp, messageId: out.messageId, ok: true });
        logSend({
          req,
          feature: 'meeting_invite',
          to: r.whatsapp,
          subject: `Meeting "${meeting.title}"`,
          success: true,
          messageId: out.messageId,
        });
      } catch (err) {
        results.push({ to: r.whatsapp, ok: false, error: err.message });
        logSend({
          req,
          feature: 'meeting_invite',
          to: r.whatsapp,
          subject: `Meeting "${meeting.title}"`,
          success: false,
          errorMsg: err.message,
        });
      }
    }

    const okCount = results.filter((r) => r.ok).length;
    return res.status(200).json({
      success: okCount > 0,
      sent: okCount,
      total: results.length,
      results,
    });
  } catch (err) {
    console.error('sendMeetingInviteViaWhatsapp error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
