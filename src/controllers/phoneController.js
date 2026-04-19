import User from '../models/User.js';
import Organization from '../models/Organization.js';
import PhoneChangeRequest from '../models/PhoneChangeRequest.js';
import { sendEmail } from '../services/emailService.js';

const APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1000;

function isValidPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

function normalizePhone(raw) {
  return String(raw || '').trim();
}

async function phoneUsedByAnotherUser(phone, selfId) {
  const dup = await User.findOne({ phoneNumber: phone }).select('_id').lean();
  return !!(dup && String(dup._id) !== String(selfId));
}

async function resolveSuperadminId(user) {
  if (user.role === 'superadmin') return user._id;
  if (!user.organizationId) return null;
  const org = await Organization.findById(user.organizationId).select('superadminId').lean();
  return org?.superadminId || null;
}

function emailRequestToSuperadmin(superadminEmail, requester, reason) {
  const subject = `Phone change request — ${requester.name}`;
  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
      <h2 style="margin-top:0;">Phone number change request</h2>
      <p><strong>${requester.name}</strong> (${requester.email}) has requested permission to update their phone number.</p>
      ${requester.phoneNumber ? `<p>Current phone: <strong>${requester.phoneNumber}</strong></p>` : ''}
      ${reason ? `<p>Reason: ${reason}</p>` : ''}
      <p>Review and approve or reject this request from your Settings page in Productivo.</p>
      <p style="color:#6b7280;font-size:12px;margin-top:24px;">Productivo · Phone change approval</p>
    </div>`;
  return sendEmail(superadminEmail, subject, html).catch(() => {});
}

function emailDecisionToUser(userEmail, userName, approved, note) {
  const subject = approved ? 'Phone change approved — you have 24 hours' : 'Phone change request rejected';
  const html = approved
    ? `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
        <h2>Phone change approved ✓</h2>
        <p>Hi ${userName}, your superadmin has approved your phone number change.</p>
        <p><strong>You have 24 hours</strong> to update your phone number in Settings → Profile.</p>
        ${note ? `<p>Note: ${note}</p>` : ''}
      </div>`
    : `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
        <h2>Phone change rejected</h2>
        <p>Hi ${userName}, your superadmin did not approve your request.</p>
        ${note ? `<p>Reason: ${note}</p>` : ''}
      </div>`;
  return sendEmail(userEmail, subject, html).catch(() => {});
}

// POST /api/v1/auth/profile/phone — one-time set when empty
export const setPhone = async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phoneNumber);
    if (!isValidPhone(phone)) {
      return res.status(400).json({ success: false, error: 'Enter a valid phone number (10–15 digits).' });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    if (user.phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number is already set. Submit a change request to modify it.',
      });
    }
    if (await phoneUsedByAnotherUser(phone, user._id)) {
      return res.status(400).json({
        success: false,
        error: 'This phone number is already registered to another user.',
      });
    }
    user.phoneNumber = phone;
    await user.save();
    return res.status(200).json({ success: true, data: { phoneNumber: user.phoneNumber } });
  } catch (err) {
    console.error('setPhone error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to save phone.' });
  }
};

// POST /api/v1/auth/profile/phone/request-change — user asks superadmin for permission
export const requestPhoneChange = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
    if (!user.phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'You have no phone set yet. Use the one-time set flow instead.',
      });
    }

    const superadminId = await resolveSuperadminId(user);
    if (!superadminId) {
      return res.status(400).json({ success: false, error: 'No superadmin found to review your request.' });
    }
    if (String(superadminId) === String(user._id)) {
      // Superadmin editing their own phone — auto-approve: give them the 24h window now
      user.phoneEditUntil = new Date(Date.now() + APPROVAL_WINDOW_MS);
      await user.save();
      return res.status(200).json({
        success: true,
        autoApproved: true,
        phoneEditUntil: user.phoneEditUntil,
      });
    }

    // Check for an existing pending request
    const existing = await PhoneChangeRequest.findOne({ userId: user._id, status: 'pending' });
    if (existing) {
      return res.status(200).json({ success: true, pending: true, request: existing });
    }

    const reason = (req.body?.reason || '').toString().trim().slice(0, 300);
    const request = await PhoneChangeRequest.create({
      userId: user._id,
      organizationId: user.organizationId || null,
      superadminId,
      currentPhone: user.phoneNumber,
      reason,
    });

    const superadmin = await User.findById(superadminId).select('email name').lean();
    if (superadmin?.email) {
      emailRequestToSuperadmin(superadmin.email, user, reason);
    }

    return res.status(200).json({ success: true, pending: true, request });
  } catch (err) {
    console.error('requestPhoneChange error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to submit request.' });
  }
};

// PATCH /api/v1/auth/profile/phone — user updates phone during the 24h approval window
export const updatePhone = async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phoneNumber);
    if (!isValidPhone(phone)) {
      return res.status(400).json({ success: false, error: 'Enter a valid phone number (10–15 digits).' });
    }
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, error: 'User not found.' });

    if (!user.phoneEditUntil || user.phoneEditUntil < new Date()) {
      return res.status(403).json({
        success: false,
        error: 'You need an approved change request before updating your phone.',
      });
    }
    if (await phoneUsedByAnotherUser(phone, user._id)) {
      return res.status(400).json({
        success: false,
        error: 'This phone number is already registered to another user.',
      });
    }

    user.phoneNumber = phone;
    user.phoneEditUntil = null; // burn the window after use
    await user.save();
    return res.status(200).json({ success: true, data: { phoneNumber: user.phoneNumber } });
  } catch (err) {
    console.error('updatePhone error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to update phone.' });
  }
};

// GET /api/v1/auth/phone-change-requests — superadmin lists pending requests for their org
export const listPendingRequests = async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'Superadmin only.' });
    }
    const requests = await PhoneChangeRequest.find({
      superadminId: req.user._id,
      status: 'pending',
    })
      .populate('userId', 'name email phoneNumber role')
      .sort({ createdAt: -1 })
      .lean();
    return res.status(200).json({ success: true, data: requests });
  } catch (err) {
    console.error('listPendingRequests error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to load requests.' });
  }
};

// POST /api/v1/auth/phone-change-requests/:id/approve
export const approvePhoneChange = async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'Superadmin only.' });
    }
    const request = await PhoneChangeRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, error: 'Request not found.' });
    if (String(request.superadminId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'This request is not yours to review.' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Request already ${request.status}.` });
    }

    const note = (req.body?.note || '').toString().trim().slice(0, 300);
    request.status = 'approved';
    request.reviewedAt = new Date();
    request.reviewedBy = req.user._id;
    request.reviewNote = note;
    await request.save();

    const user = await User.findById(request.userId);
    if (user) {
      user.phoneEditUntil = new Date(Date.now() + APPROVAL_WINDOW_MS);
      await user.save();
      emailDecisionToUser(user.email, user.name, true, note);
    }

    return res.status(200).json({ success: true, data: request });
  } catch (err) {
    console.error('approvePhoneChange error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to approve.' });
  }
};

// POST /api/v1/auth/phone-change-requests/:id/reject
export const rejectPhoneChange = async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'Superadmin only.' });
    }
    const request = await PhoneChangeRequest.findById(req.params.id);
    if (!request) return res.status(404).json({ success: false, error: 'Request not found.' });
    if (String(request.superadminId) !== String(req.user._id)) {
      return res.status(403).json({ success: false, error: 'This request is not yours to review.' });
    }
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, error: `Request already ${request.status}.` });
    }

    const note = (req.body?.note || '').toString().trim().slice(0, 300);
    request.status = 'rejected';
    request.reviewedAt = new Date();
    request.reviewedBy = req.user._id;
    request.reviewNote = note;
    await request.save();

    const user = await User.findById(request.userId);
    if (user) emailDecisionToUser(user.email, user.name, false, note);

    return res.status(200).json({ success: true, data: request });
  } catch (err) {
    console.error('rejectPhoneChange error:', err.message);
    return res.status(500).json({ success: false, error: 'Failed to reject.' });
  }
};
