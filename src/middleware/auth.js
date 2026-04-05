import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Access denied. No token provided.' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(decoded.userId).select('-passwordHash -mpinHash');

    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid token. User not found.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, error: 'Account is deactivated.' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, error: 'Invalid token.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expired.' });
    }
    return res.status(500).json({ success: false, error: 'Authentication error.' });
  }
};

/**
 * Requires user to belong to an organization.
 * product_owner bypasses this (they have no org).
 */
export const requireOrg = (req, res, next) => {
  if (req.user.role === 'product_owner') return next();
  if (!req.user.organizationId) {
    return res.status(403).json({
      success: false,
      error: 'You must create or join an organization first.',
      code: 'NO_ORG',
    });
  }
  next();
};

/**
 * Requires product_owner role only.
 * Used for: platform-level overview, all-org stats, logs.
 */
export const requireProductOwner = (req, res, next) => {
  if (req.user.role !== 'product_owner') {
    return res.status(403).json({ success: false, error: 'Product owner access required.' });
  }
  next();
};

/**
 * @deprecated Use requireProductOwner for platform-level routes.
 * Kept as alias so existing route imports don't break.
 */
export const requireSuperAdmin = requireProductOwner;

/**
 * Requires product_owner OR superadmin OR org_admin role.
 * superadmin and org_admin must belong to an org (they are org-scoped).
 * product_owner passes freely.
 */
export const requireOrgAdmin = (req, res, next) => {
  if (req.user.role === 'product_owner') return next();

  if (req.user.role !== 'superadmin' && req.user.role !== 'org_admin') {
    return res.status(403).json({ success: false, error: 'Admin access required.' });
  }
  if (!req.user.organizationId) {
    return res.status(403).json({
      success: false,
      error: 'You must create or join an organization first.',
      code: 'NO_ORG',
    });
  }
  next();
};

/**
 * Requires at least org_admin or superadmin (org-scoped) or product_owner.
 */
export const requireAdmin = requireOrgAdmin;

/**
 * Allows product_owner, superadmin, org_admin, and employee (all authenticated org members).
 * product_owner passes freely.
 * superadmin/org_admin/employee must belong to an org.
 */
export const requireOrgMember = (req, res, next) => {
  if (req.user.role === 'product_owner') return next();

  if (!req.user.organizationId) {
    return res.status(403).json({
      success: false,
      error: 'You must join an organization first.',
      code: 'NO_ORG',
    });
  }
  next();
};

export const generateToken = (userId) => {
  return jwt.sign({ userId }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
};

/**
 * Returns the set of organizationId values that the requesting user is
 * allowed to query.
 *
 * Isolation rules:
 *  - product_owner  → no org data access (returns null — caller must block)
 *  - superadmin     → all orgs whose superadminId === user._id (master + children)
 *  - org_admin      → only their own organizationId
 *  - employee       → only their own organizationId
 *
 * Returns: { single: ObjectId|null, many: ObjectId[]|null }
 *   single  — the single org a user belongs to (non-superadmin roles)
 *   many    — all org IDs for a superadmin (used for $in queries)
 *
 * Callers should check: if (!scope) → 403
 */
export const getSuperadminOrgIds = async (user) => {
  if (user.role === 'product_owner') return null;

  if (user.role === 'superadmin') {
    const orgs = await Organization.find({ superadminId: user._id }).select('_id').lean();
    return orgs.map((o) => o._id);
  }

  // org_admin / employee: only their own org
  if (user.organizationId) return [user.organizationId];
  return null;
};
