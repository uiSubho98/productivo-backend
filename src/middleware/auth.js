import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';

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
 */
export const requireOrg = (req, res, next) => {
  if (req.user.role === 'superadmin') return next();
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
 * Requires superadmin role.
 */
export const requireSuperAdmin = (req, res, next) => {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ success: false, error: 'Superadmin access required.' });
  }
  next();
};

/**
 * Requires superadmin OR org_admin role.
 * org_admin must also belong to an org.
 */
export const requireOrgAdmin = (req, res, next) => {
  if (req.user.role === 'superadmin') return next();

  if (req.user.role !== 'org_admin') {
    return res.status(403).json({ success: false, error: 'Admin access required.' });
  }
  if (!req.user.organizationId) {
    return res.status(403).json({ success: false, error: 'You must create or join an organization first.', code: 'NO_ORG' });
  }
  next();
};

/**
 * Requires at least org_admin or superadmin.
 * Used for: managing members, categories, org settings, invoices, clients, projects.
 */
export const requireAdmin = requireOrgAdmin;

/**
 * Allows superadmin, org_admin, and employee (all authenticated org members).
 * Employees get filtered data in controllers.
 */
export const requireOrgMember = (req, res, next) => {
  if (req.user.role === 'superadmin') return next();

  if (!req.user.organizationId) {
    return res.status(403).json({ success: false, error: 'You must join an organization first.', code: 'NO_ORG' });
  }
  next();
};

export const generateToken = (userId) => {
  return jwt.sign({ userId }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
};
