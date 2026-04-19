import mongoose from 'mongoose';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import Task from '../models/Task.js';
import Invoice from '../models/Invoice.js';
import Meeting from '../models/Meeting.js';
import ActivityLog from '../models/ActivityLog.js';

/**
 * Resolve which org IDs the current request is scoped to.
 * - superadmin → all orgs owned by them
 * - org_admin → just their own org
 * - product_owner → whatever ?superadminId=X (their orgs) OR ?orgId=X OR all (null = platform)
 * Returns { scope: 'self'|'superadmin'|'org'|'platform', orgIds: ObjectId[] | null, target: {...}|null }
 * When orgIds is null, no filter is applied (platform-wide).
 */
async function resolveScope(req) {
  const user = req.user;

  if (user.role === 'product_owner') {
    const { superadminId, orgId } = req.query;
    if (superadminId && mongoose.Types.ObjectId.isValid(superadminId)) {
      const orgs = await Organization.find({ superadminId }).select('_id name parentOrgId').lean();
      const sa = await User.findById(superadminId).select('name email').lean();
      return {
        scope: 'superadmin',
        orgIds: orgs.map((o) => o._id),
        target: {
          kind: 'superadmin',
          id: superadminId,
          name: sa?.name,
          email: sa?.email,
          orgs,
        },
      };
    }
    if (orgId && mongoose.Types.ObjectId.isValid(orgId)) {
      const org = await Organization.findById(orgId).select('name superadminId parentOrgId').lean();
      return {
        scope: 'org',
        orgIds: org ? [org._id] : [],
        target: org ? { kind: 'org', id: org._id, name: org.name } : null,
      };
    }
    return { scope: 'platform', orgIds: null, target: { kind: 'platform' } };
  }

  if (user.role === 'superadmin') {
    const orgs = await Organization.find({ superadminId: user._id }).select('_id name parentOrgId').lean();
    return {
      scope: 'self',
      orgIds: orgs.map((o) => o._id),
      target: {
        kind: 'superadmin',
        id: user._id,
        name: user.name,
        email: user.email,
        orgs,
      },
    };
  }

  if (user.role === 'org_admin' && user.organizationId) {
    const org = await Organization.findById(user.organizationId).select('name').lean();
    return {
      scope: 'self',
      orgIds: [user.organizationId],
      target: org ? { kind: 'org', id: org._id, name: org.name } : null,
    };
  }

  return { scope: 'self', orgIds: [], target: null };
}

function orgFilter(orgIds) {
  if (orgIds === null) return {}; // platform-wide
  if (!orgIds.length) return { _id: null }; // no access → returns nothing
  return { organizationId: { $in: orgIds } };
}

// GET /api/v1/usage/overview
export const getUsageOverview = async (req, res) => {
  try {
    const { scope, orgIds, target } = await resolveScope(req);
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const filter = orgFilter(orgIds);

    const [users, clients, projects, tasks, invoices, meetings] = await Promise.all([
      User.countDocuments(filter),
      Client.countDocuments(filter),
      Project.countDocuments(filter),
      Task.countDocuments(filter),
      Invoice.countDocuments(filter),
      Meeting.countDocuments(filter),
    ]);

    // ActivityLog counts — scoped by orgFilter where applicable
    const actFilter = orgFilter(orgIds);
    const [
      apiToday, apiMonth, apiErrorsMonth,
      emailToday, emailMonth, emailFailedMonth,
      waToday, waMonth, waFailedMonth,
    ] = await Promise.all([
      ActivityLog.countDocuments({ ...actFilter, type: 'api', createdAt: { $gte: startOfDay } }),
      ActivityLog.countDocuments({ ...actFilter, type: 'api', createdAt: { $gte: startOfMonth } }),
      ActivityLog.countDocuments({ ...actFilter, type: 'api', success: false, createdAt: { $gte: startOfMonth } }),
      ActivityLog.countDocuments({ ...actFilter, type: 'email', success: true, createdAt: { $gte: startOfDay } }),
      ActivityLog.countDocuments({ ...actFilter, type: 'email', success: true, createdAt: { $gte: startOfMonth } }),
      ActivityLog.countDocuments({ ...actFilter, type: 'email', success: false, createdAt: { $gte: startOfMonth } }),
      ActivityLog.countDocuments({ ...actFilter, type: 'whatsapp', success: true, createdAt: { $gte: startOfDay } }),
      ActivityLog.countDocuments({ ...actFilter, type: 'whatsapp', success: true, createdAt: { $gte: startOfMonth } }),
      ActivityLog.countDocuments({ ...actFilter, type: 'whatsapp', success: false, createdAt: { $gte: startOfMonth } }),
    ]);

    // 6-month trend
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const [api, email, whatsapp] = await Promise.all([
        ActivityLog.countDocuments({ ...actFilter, type: 'api', createdAt: { $gte: mStart, $lte: mEnd } }),
        ActivityLog.countDocuments({ ...actFilter, type: 'email', success: true, createdAt: { $gte: mStart, $lte: mEnd } }),
        ActivityLog.countDocuments({ ...actFilter, type: 'whatsapp', success: true, createdAt: { $gte: mStart, $lte: mEnd } }),
      ]);
      trend.push({
        month: mStart.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
        api, email, whatsapp,
      });
    }

    // Recent activity — last 50 entries
    const recent = await ActivityLog.find(actFilter)
      .sort({ createdAt: -1 })
      .limit(50)
      .select('type method path statusCode userEmail userRole to subject success errorMsg durationMs createdAt')
      .lean();

    return res.status(200).json({
      success: true,
      data: {
        scope,
        target,
        db: { users, clients, projects, tasks, invoices, meetings },
        activity: {
          api: { today: apiToday, thisMonth: apiMonth, errorsThisMonth: apiErrorsMonth },
          email: { today: emailToday, thisMonth: emailMonth, failedThisMonth: emailFailedMonth },
          whatsapp: { today: waToday, thisMonth: waMonth, failedThisMonth: waFailedMonth },
        },
        trend,
        recent,
      },
    });
  } catch (err) {
    console.error('getUsageOverview error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load usage data.' });
  }
};

// GET /api/v1/usage/superadmins — product_owner only, list of superadmins to choose from
export const listSuperadminsForUsage = async (req, res) => {
  try {
    if (req.user.role !== 'product_owner') {
      return res.status(403).json({ success: false, error: 'Product owner only.' });
    }
    const users = await User.find({ role: 'superadmin', isActive: true })
      .select('name email')
      .sort({ name: 1 })
      .lean();
    return res.status(200).json({ success: true, data: users });
  } catch (err) {
    console.error('listSuperadminsForUsage error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load superadmins.' });
  }
};
