/**
 * Feature Flag Controller — WhatsApp toggle
 *
 * Routes (registered at /api/v1/feature-flags):
 *   GET    /whatsapp/me               — superadmin/org_admin check their own status
 *   GET    /whatsapp                  — product_owner: list all superadmins + their WA status
 *   GET    /whatsapp/:superadminId    — product_owner: get one superadmin's WA flag
 *   PUT    /whatsapp/:superadminId    — product_owner: enable/disable + set expiry
 */

import User from '../models/User.js';
import Organization from '../models/Organization.js';
import WhatsappFeature from '../models/WhatsappFeature.js';
import {
  resolveExpiry,
  invalidateWhatsappCache,
  isWhatsappEnabledForOrg,
  isWhatsappEnabledForSuperadmin,
} from '../services/whatsappFeatureService.js';

// ─────────────────────────────────────────────────────────────────
// GET /api/v1/feature-flags/whatsapp/me
// Superadmin / org_admin check their own WhatsApp addon status.
// Returns isActive, expiresAt, expiryLabel.
// ─────────────────────────────────────────────────────────────────
export const getMyWhatsappStatus = async (req, res) => {
  try {
    // Resolve the superadminId for this user's org tree
    let superadminId = null;
    if (req.user.role === 'superadmin') {
      superadminId = req.user._id;
    } else if (req.user.organizationId) {
      const org = await Organization.findById(req.user.organizationId).select('superadminId').lean();
      superadminId = org?.superadminId || null;
    }

    if (!superadminId) {
      return res.status(200).json({
        success: true,
        data: { isActive: false, isEnabled: false, expiresAt: null, expiryLabel: 'never', reason: 'No superadmin linked to your organization.' },
      });
    }

    const { enabled, reason } = await isWhatsappEnabledForSuperadmin(superadminId);

    const record = await WhatsappFeature.findOne({ superadminId }).select('isEnabled expiresAt expiryLabel').lean();
    const now = new Date();
    const isExpired = record?.expiresAt ? now >= new Date(record.expiresAt) : false;

    return res.status(200).json({
      success: true,
      data: {
        isActive: enabled,
        isEnabled: record?.isEnabled ?? false,
        isExpired,
        expiresAt: record?.expiresAt ?? null,
        expiryLabel: record?.expiryLabel ?? 'never',
        reason: enabled ? 'WhatsApp add-on is active.' : reason,
      },
    });
  } catch (error) {
    console.error('getMyWhatsappStatus error:', error);
    return res.status(500).json({ success: false, error: 'Failed to check WhatsApp status.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/v1/feature-flags/whatsapp
// List all superadmins with their current WA feature state.
// ─────────────────────────────────────────────────────────────────
export const listWhatsappFlags = async (req, res) => {
  try {
    // All superadmin users
    const superadmins = await User.find({ role: 'superadmin', isActive: true })
      .select('name email organizationId')
      .lean();

    if (superadmins.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const saIds = superadmins.map((u) => u._id);

    // Master org for each superadmin
    const orgs = await Organization.find({
      superadminId: { $in: saIds },
      parentOrgId: null,
    }).select('name superadminId').lean();
    const orgMap = {};
    for (const o of orgs) {
      orgMap[String(o.superadminId)] = o.name;
    }

    // Existing feature records
    const flags = await WhatsappFeature.find({ superadminId: { $in: saIds } }).lean();
    const flagMap = {};
    for (const f of flags) {
      flagMap[String(f.superadminId)] = f;
    }

    const now = new Date();

    const data = superadmins.map((sa) => {
      const flag = flagMap[String(sa._id)];
      const isEnabled = flag?.isEnabled ?? false;
      const expiresAt = flag?.expiresAt ?? null;
      const isExpired = expiresAt ? now >= new Date(expiresAt) : false;
      const isActive = isEnabled && !isExpired;

      return {
        superadminId: sa._id,
        name: sa.name,
        email: sa.email,
        masterOrg: orgMap[String(sa._id)] || null,
        whatsapp: {
          isEnabled,
          isActive,
          expiresAt,
          expiryLabel: flag?.expiryLabel ?? 'never',
          isExpired,
          note: flag?.note ?? '',
          updatedAt: flag?.updatedAt ?? null,
        },
      };
    });

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error('listWhatsappFlags error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch feature flags.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// GET /api/v1/feature-flags/whatsapp/:superadminId
// Get one superadmin's WA flag detail.
// ─────────────────────────────────────────────────────────────────
export const getWhatsappFlag = async (req, res) => {
  try {
    const { superadminId } = req.params;

    const sa = await User.findOne({ _id: superadminId, role: 'superadmin' })
      .select('name email organizationId')
      .lean();
    if (!sa) {
      return res.status(404).json({ success: false, error: 'Superadmin not found.' });
    }

    const flag = await WhatsappFeature.findOne({ superadminId }).lean();
    const now = new Date();
    const isEnabled = flag?.isEnabled ?? false;
    const expiresAt = flag?.expiresAt ?? null;
    const isExpired = expiresAt ? now >= new Date(expiresAt) : false;

    return res.status(200).json({
      success: true,
      data: {
        superadminId: sa._id,
        name: sa.name,
        email: sa.email,
        whatsapp: {
          isEnabled,
          isActive: isEnabled && !isExpired,
          expiresAt,
          expiryLabel: flag?.expiryLabel ?? 'never',
          isExpired,
          note: flag?.note ?? '',
          updatedAt: flag?.updatedAt ?? null,
          updatedBy: flag?.updatedBy ?? null,
        },
      },
    });
  } catch (error) {
    console.error('getWhatsappFlag error:', error);
    return res.status(500).json({ success: false, error: 'Failed to get feature flag.' });
  }
};

// ─────────────────────────────────────────────────────────────────
// PUT /api/v1/feature-flags/whatsapp/:superadminId
// Enable or disable WhatsApp for a superadmin. Set expiry.
//
// Body:
//   isEnabled   : boolean (required)
//   expiryLabel : 'never' | '1_week' | '3_months' | '6_months' | 'custom'
//   customDate  : ISO date string (required only when expiryLabel = 'custom')
//   note        : string (optional)
// ─────────────────────────────────────────────────────────────────
export const setWhatsappFlag = async (req, res) => {
  try {
    const { superadminId } = req.params;
    const { isEnabled, expiryLabel = 'never', customDate, note } = req.body;

    if (typeof isEnabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isEnabled must be a boolean.' });
    }

    // Verify target is a real superadmin
    const sa = await User.findOne({ _id: superadminId, role: 'superadmin' })
      .select('name email')
      .lean();
    if (!sa) {
      return res.status(404).json({ success: false, error: 'Superadmin not found.' });
    }

    // Resolve expiry dates
    let expiresAt = null;
    let resolvedLabel = 'never';
    if (isEnabled) {
      // Only set expiry when enabling. When disabling, clear the expiry.
      try {
        const resolved = resolveExpiry(expiryLabel, customDate);
        expiresAt = resolved.expiresAt;
        resolvedLabel = resolved.expiryLabel;
      } catch (err) {
        return res.status(400).json({ success: false, error: err.message });
      }
    } else {
      expiresAt = null;
      resolvedLabel = 'never';
    }

    const updatePayload = {
      isEnabled,
      expiresAt,
      expiryLabel: resolvedLabel,
      updatedBy: req.user._id,
    };
    if (note !== undefined) updatePayload.note = note;

    const flag = await WhatsappFeature.findOneAndUpdate(
      { superadminId },
      { $set: updatePayload },
      { upsert: true, new: true, runValidators: true }
    );

    // Immediately invalidate cache so effect is instant
    invalidateWhatsappCache(superadminId);

    const now = new Date();
    const isExpired = flag.expiresAt ? now >= new Date(flag.expiresAt) : false;

    return res.status(200).json({
      success: true,
      data: {
        superadminId: sa._id,
        name: sa.name,
        email: sa.email,
        whatsapp: {
          isEnabled: flag.isEnabled,
          isActive: flag.isEnabled && !isExpired,
          expiresAt: flag.expiresAt,
          expiryLabel: flag.expiryLabel,
          isExpired,
          note: flag.note,
          updatedAt: flag.updatedAt,
        },
      },
      message: isEnabled
        ? `WhatsApp enabled for ${sa.email}${expiresAt ? ` until ${expiresAt.toLocaleDateString('en-IN')}` : ' (never expires)'}.`
        : `WhatsApp disabled for ${sa.email}.`,
    });
  } catch (error) {
    console.error('setWhatsappFlag error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update feature flag.' });
  }
};
