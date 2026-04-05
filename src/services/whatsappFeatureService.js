/**
 * WhatsApp Feature Gate Service
 *
 * All WhatsApp sends (messages, documents, tab access, scheduler reminders)
 * must pass through isWhatsappEnabled() before proceeding.
 *
 * Lookup chain:
 *   organizationId  →  Organization.superadminId  →  WhatsappFeature record
 *
 * If no record exists for a superadmin, the feature is DISABLED by default.
 */

import Organization from '../models/Organization.js';
import WhatsappFeature from '../models/WhatsappFeature.js';

// In-process cache: orgId → { enabled, expiresAt, cachedAt }
// TTL = 60 seconds (feature toggle takes effect within 1 minute)
const _cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

function _cacheKey(superadminId) {
  return String(superadminId);
}

function _isCacheValid(entry) {
  return entry && Date.now() - entry.cachedAt < CACHE_TTL_MS;
}

/**
 * Resolve superadminId from an organizationId.
 * Returns null if org not found or has no superadminId.
 */
async function getSuperadminIdForOrg(organizationId) {
  if (!organizationId) return null;
  const org = await Organization.findById(organizationId).select('superadminId').lean();
  return org?.superadminId || null;
}

/**
 * Check if WhatsApp is currently enabled for a given superadminId.
 * Uses a short in-process cache to avoid hitting MongoDB on every send.
 *
 * @param {ObjectId|string} superadminId
 * @returns {Promise<{ enabled: boolean, reason: string }>}
 */
export async function isWhatsappEnabledForSuperadmin(superadminId) {
  if (!superadminId) return { enabled: false, reason: 'No superadmin associated' };

  const key = _cacheKey(superadminId);
  const cached = _cache.get(key);
  if (_isCacheValid(cached)) {
    return cached.result;
  }

  const record = await WhatsappFeature.findOne({ superadminId }).lean();

  if (!record) {
    const result = { enabled: false, reason: 'WhatsApp feature not activated. Contact your administrator.' };
    _cache.set(key, { result, cachedAt: Date.now() });
    return result;
  }

  if (!record.isEnabled) {
    const result = { enabled: false, reason: 'WhatsApp feature is disabled for your account.' };
    _cache.set(key, { result, cachedAt: Date.now() });
    return result;
  }

  if (record.expiresAt && new Date() >= new Date(record.expiresAt)) {
    const result = { enabled: false, reason: 'WhatsApp feature access has expired. Please contact your administrator.' };
    _cache.set(key, { result, cachedAt: Date.now() });
    return result;
  }

  const result = { enabled: true, reason: 'ok' };
  _cache.set(key, { result, cachedAt: Date.now() });
  return result;
}

/**
 * Check if WhatsApp is enabled for a given organizationId.
 * Resolves the superadmin via org lookup, then checks the feature flag.
 *
 * @param {ObjectId|string} organizationId
 * @returns {Promise<{ enabled: boolean, reason: string }>}
 */
export async function isWhatsappEnabledForOrg(organizationId) {
  const superadminId = await getSuperadminIdForOrg(organizationId);
  return isWhatsappEnabledForSuperadmin(superadminId);
}

/**
 * Invalidate the cache for a superadmin immediately after a toggle.
 * Called by the product_owner controller after updating a flag.
 *
 * @param {ObjectId|string} superadminId
 */
export function invalidateWhatsappCache(superadminId) {
  _cache.delete(_cacheKey(superadminId));
}

/**
 * Compute an expiry Date from a label + optional custom date string.
 *
 * labels: 'never' | '1_week' | '3_months' | '6_months' | 'custom'
 * For 'custom', customDate (ISO string or Date) must be provided.
 *
 * @returns {{ expiresAt: Date|null, expiryLabel: string }}
 */
export function resolveExpiry(label, customDate) {
  const now = new Date();
  switch (label) {
    case 'never':
      return { expiresAt: null, expiryLabel: 'never' };
    case '1_week': {
      const d = new Date(now);
      d.setDate(d.getDate() + 7);
      return { expiresAt: d, expiryLabel: '1_week' };
    }
    case '3_months': {
      const d = new Date(now);
      d.setMonth(d.getMonth() + 3);
      return { expiresAt: d, expiryLabel: '3_months' };
    }
    case '6_months': {
      const d = new Date(now);
      d.setMonth(d.getMonth() + 6);
      return { expiresAt: d, expiryLabel: '6_months' };
    }
    case 'custom': {
      if (!customDate) throw new Error('customDate is required when label is "custom".');
      const d = new Date(customDate);
      if (isNaN(d.getTime())) throw new Error('Invalid customDate value.');
      if (d <= now) throw new Error('customDate must be in the future.');
      return { expiresAt: d, expiryLabel: 'custom' };
    }
    default:
      throw new Error(`Unknown expiry label "${label}". Use: never, 1_week, 3_months, 6_months, custom.`);
  }
}
