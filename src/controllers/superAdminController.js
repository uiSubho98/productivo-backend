import mongoose from 'mongoose';
import ActivityLog from '../models/ActivityLog.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Invoice from '../models/Invoice.js';
import Meeting from '../models/Meeting.js';
import Task from '../models/Task.js';
import Project from '../models/Project.js';
import Client from '../models/Client.js';
import Enquiry from '../models/Enquiry.js';
import Purchase from '../models/Purchase.js';
import Subscription from '../models/Subscription.js';
import Category from '../models/Category.js';
import WhatsappFeature from '../models/WhatsappFeature.js';
import { getDailyCount } from '../services/whatsappService.js';
import { getLocationUsage } from '../routes/location.js';

/**
 * GET /api/v1/superadmin/users?search=&page=1&limit=20
 * Lists all superadmin accounts (paid clients) platform-wide.
 * product_owner only.
 */
export const getUsers = async (req, res) => {
  try {
    const { search, page = 1, limit = 20 } = req.query;
    const filter = { role: 'superadmin' };

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await User.countDocuments(filter);
    const users = await User.find(filter)
      .select('-passwordHash -mpinHash')
      .populate('organizationId', 'name logo')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error('SuperAdmin getUsers error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch users.' });
  }
};

/**
 * GET /api/v1/superadmin/overview
 * Full platform overview: API logs, email/WA usage, DB stats.
 * Superadmin only.
 */
export const getOverview = async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // ── DB Collection Stats ──────────────────────────────────────────────────
    const [
      totalUsers, totalOrgs, totalInvoices, totalMeetings,
      totalTasks, totalProjects, totalClients, totalActivityLogs,
      totalEnquiries, newEnquiries, premiumEnquiries,
    ] = await Promise.all([
      User.countDocuments(),
      Organization.countDocuments(),
      Invoice.countDocuments(),
      Meeting.countDocuments(),
      Task.countDocuments(),
      Project.countDocuments(),
      Client.countDocuments(),
      ActivityLog.countDocuments(),
      Enquiry.countDocuments(),
      Enquiry.countDocuments({ status: 'new' }),
      Enquiry.countDocuments({ source: 'premium_feature' }),
    ]);

    // ── MongoDB native DB + collection stats ─────────────────────────────────
    const db = mongoose.connection.db;
    const [dbStats, collectionNames] = await Promise.all([
      db.command({ dbStats: 1, scale: 1024 }), // sizes in KB
      db.listCollections().toArray(),
    ]);

    const collectionStats = await Promise.all(
      collectionNames.map(async (col) => {
        try {
          const stats = await db.command({ collStats: col.name, scale: 1024 });
          return {
            name: col.name,
            count: stats.count,
            sizeKB: Math.round(stats.size),
            avgObjSizeBytes: Math.round(stats.avgObjSize || 0),
            totalIndexSizeKB: Math.round(stats.totalIndexSize),
            indexes: stats.nindexes,
          };
        } catch {
          return { name: col.name, count: 0, sizeKB: 0, avgObjSizeBytes: 0, totalIndexSizeKB: 0, indexes: 0 };
        }
      })
    );
    collectionStats.sort((a, b) => b.sizeKB - a.sizeKB);

    // ── Email Usage ──────────────────────────────────────────────────────────
    const [emailToday, emailThisMonth, emailLastMonth, emailFailed] = await Promise.all([
      ActivityLog.countDocuments({ type: 'email', success: true, createdAt: { $gte: startOfDay } }),
      ActivityLog.countDocuments({ type: 'email', success: true, createdAt: { $gte: startOfMonth } }),
      ActivityLog.countDocuments({ type: 'email', success: true, createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } }),
      ActivityLog.countDocuments({ type: 'email', success: false, createdAt: { $gte: startOfMonth } }),
    ]);

    // ── WhatsApp Usage ───────────────────────────────────────────────────────
    const waDaily = getDailyCount(); // in-memory: { date, count, limit }
    const [waThisMonth, waLastMonth, waFailed] = await Promise.all([
      ActivityLog.countDocuments({ type: 'whatsapp', success: true, createdAt: { $gte: startOfMonth } }),
      ActivityLog.countDocuments({ type: 'whatsapp', success: true, createdAt: { $gte: startOfLastMonth, $lte: endOfLastMonth } }),
      ActivityLog.countDocuments({ type: 'whatsapp', success: false, createdAt: { $gte: startOfMonth } }),
    ]);

    // ── API Activity (last 24h) ──────────────────────────────────────────────
    const [apiToday, apiErrors, recentLogs] = await Promise.all([
      ActivityLog.countDocuments({ type: 'api', createdAt: { $gte: startOfDay } }),
      ActivityLog.countDocuments({ type: 'api', success: false, createdAt: { $gte: startOfDay } }),
      ActivityLog.find({ type: 'api' })
        .sort({ createdAt: -1 })
        .limit(50)
        .select('method path statusCode userEmail userRole ip durationMs createdAt success'),
    ]);

    // ── Monthly API volume (last 6 months) ───────────────────────────────────
    const monthlyApi = [];
    for (let i = 5; i >= 0; i--) {
      const mStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
      const [apiCount, emailCount, waCount] = await Promise.all([
        ActivityLog.countDocuments({ type: 'api', createdAt: { $gte: mStart, $lte: mEnd } }),
        ActivityLog.countDocuments({ type: 'email', success: true, createdAt: { $gte: mStart, $lte: mEnd } }),
        ActivityLog.countDocuments({ type: 'whatsapp', success: true, createdAt: { $gte: mStart, $lte: mEnd } }),
      ]);
      monthlyApi.push({
        month: mStart.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
        api: apiCount,
        emails: emailCount,
        whatsapp: waCount,
      });
    }

    // ── Top endpoints (today) ─────────────────────────────────────────────────
    const topEndpoints = await ActivityLog.aggregate([
      { $match: { type: 'api', createdAt: { $gte: startOfDay } } },
      { $group: { _id: { method: '$method', path: '$path' }, count: { $sum: 1 }, avgMs: { $avg: '$durationMs' } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);

    // ── Recent enquiries (all sources) ──────────────────────────────────────
    const recentEnquiries = await Enquiry.find()
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    // ── Per-superadmin breakdown (paid clients) ───────────────────────────────
    // Group all orgs by their owning superadmin
    const orgs = await Organization.find()
      .select('name superadminId parentOrgId')
      .populate('superadminId', 'name email')
      .lean();

    // Build map: superadminId → list of orgIds
    const saOrgMap = {}; // key: superadminId string
    for (const org of orgs) {
      const key = org.superadminId?._id?.toString() || 'unassigned';
      if (!saOrgMap[key]) {
        saOrgMap[key] = {
          superadmin: org.superadminId
            ? { id: org.superadminId._id, name: org.superadminId.name, email: org.superadminId.email }
            : null,
          orgIds: [],
          orgs: [],
        };
      }
      saOrgMap[key].orgIds.push(org._id);
      saOrgMap[key].orgs.push({ orgId: org._id, name: org.name, isMaster: !org.parentOrgId });
    }

    // For each superadmin group: fetch DB counts + API activity across all their orgIds
    const superadminBreakdown = await Promise.all(
      Object.values(saOrgMap).map(async (group) => {
        const orgIds = group.orgIds;

        // DB record counts across all orgs of this superadmin
        const [users, meetings, invoices, tasks, projects, clients] = await Promise.all([
          User.countDocuments({ organizationId: { $in: orgIds } }),
          Meeting.countDocuments({ organizationId: { $in: orgIds } }),
          Invoice.countDocuments({ organizationId: { $in: orgIds } }),
          Task.countDocuments({ organizationId: { $in: orgIds } }),
          Project.countDocuments({ organizationId: { $in: orgIds } }),
          Client.countDocuments({ organizationId: { $in: orgIds } }),
        ]);

        // API activity: today + this month + this month errors
        const [apiToday, apiThisMonth, apiErrors] = await Promise.all([
          ActivityLog.countDocuments({ type: 'api', organizationId: { $in: orgIds }, createdAt: { $gte: startOfDay } }),
          ActivityLog.countDocuments({ type: 'api', organizationId: { $in: orgIds }, createdAt: { $gte: startOfMonth } }),
          ActivityLog.countDocuments({ type: 'api', success: false, organizationId: { $in: orgIds }, createdAt: { $gte: startOfMonth } }),
        ]);

        // Email + WhatsApp usage this month
        const [emailsThisMonth, waThisMonth] = await Promise.all([
          ActivityLog.countDocuments({ type: 'email', success: true, organizationId: { $in: orgIds }, createdAt: { $gte: startOfMonth } }),
          ActivityLog.countDocuments({ type: 'whatsapp', success: true, organizationId: { $in: orgIds }, createdAt: { $gte: startOfMonth } }),
        ]);

        return {
          superadmin: group.superadmin,
          orgs: group.orgs,
          db: { users, meetings, invoices, tasks, projects, clients },
          api: { today: apiToday, thisMonth: apiThisMonth, errorsThisMonth: apiErrors },
          email: { thisMonth: emailsThisMonth },
          whatsapp: { thisMonth: waThisMonth },
        };
      })
    );

    return res.status(200).json({
      success: true,
      data: {
        db: {
          users: totalUsers,
          organizations: totalOrgs,
          invoices: totalInvoices,
          meetings: totalMeetings,
          tasks: totalTasks,
          projects: totalProjects,
          clients: totalClients,
          activityLogs: totalActivityLogs,
          enquiries: totalEnquiries,
          // MongoDB native stats
          native: {
            totalCollections: dbStats.collections,
            totalDocuments: dbStats.objects,
            dataSizeKB: Math.round(dbStats.dataSize),
            storageSizeKB: Math.round(dbStats.storageSize),
            indexSizeKB: Math.round(dbStats.indexSize),
            avgObjSizeBytes: Math.round(dbStats.avgObjSize || 0),
          },
          collections: collectionStats,
        },
        email: {
          today: emailToday,
          thisMonth: emailThisMonth,
          lastMonth: emailLastMonth,
          failedThisMonth: emailFailed,
          // Brevo free tier: 300/day, 9000/month
          dailyLimit: 300,
          monthlyLimit: 9000,
        },
        whatsapp: {
          today: waDaily.count,
          dailyLimit: waDaily.limit,
          thisMonth: waThisMonth,
          lastMonth: waLastMonth,
          failedThisMonth: waFailed,
        },
        api: {
          today: apiToday,
          errorsToday: apiErrors,
          recentLogs,
          monthly: monthlyApi,
          topEndpoints: topEndpoints.map((e) => ({
            method: e._id.method,
            path: e._id.path,
            count: e.count,
            avgMs: Math.round(e.avgMs || 0),
          })),
        },
        superadminBreakdown,
        enquiries: {
          total: totalEnquiries,
          new: newEnquiries,
          premium: premiumEnquiries,
          recent: recentEnquiries,
        },
        location: getLocationUsage(),
      },
    });
  } catch (error) {
    console.error('SuperAdmin overview error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch overview.' });
  }
};

/**
 * PATCH /api/v1/superadmin/accounts/:id/block
 * Toggle block/unblock a superadmin account.
 * Blocking sets isActive=false on the superadmin AND all users in their org tree.
 * Unblocking restores isActive=true for all of them.
 * product_owner only.
 */
export const blockSuperadmin = async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, error: 'User not found.' });
    if (target.role !== 'superadmin') return res.status(400).json({ success: false, error: 'Target must be a superadmin account.' });

    const newActive = !target.isActive;

    // Find all orgs owned by this superadmin
    const orgs = await Organization.find({ superadminId: target._id }).select('_id').lean();
    const orgIds = orgs.map((o) => o._id);

    // Toggle superadmin + all members across their org tree
    await User.updateMany(
      { $or: [{ _id: target._id }, { organizationId: { $in: orgIds } }] },
      { isActive: newActive }
    );

    return res.status(200).json({
      success: true,
      data: { isActive: newActive },
      message: newActive ? 'Account unblocked.' : 'Account blocked. All users in this org tree cannot log in.',
    });
  } catch (error) {
    console.error('blockSuperadmin error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update account status.' });
  }
};

/**
 * DELETE /api/v1/superadmin/accounts/:id
 * Permanently delete a superadmin and ALL data belonging to their org tree.
 * Deletes: Users, Organizations, Clients, Projects, Tasks, Invoices, Meetings,
 *          ActivityLogs, Categories, Subscription, WhatsappFeature, Purchase records.
 * product_owner only. Cannot delete product_owner accounts.
 */
export const deleteSuperadminAccount = async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, error: 'User not found.' });
    if (target.role !== 'superadmin') return res.status(400).json({ success: false, error: 'Target must be a superadmin account.' });

    // Find all orgs owned by this superadmin
    const orgs = await Organization.find({ superadminId: target._id }).select('_id').lean();
    const orgIds = orgs.map((o) => o._id);

    // Delete all org-scoped data in parallel
    await Promise.all([
      User.deleteMany({ $or: [{ _id: target._id }, { organizationId: { $in: orgIds } }] }),
      Organization.deleteMany({ superadminId: target._id }),
      Client.deleteMany({ organizationId: { $in: orgIds } }),
      Project.deleteMany({ organizationId: { $in: orgIds } }),
      Task.deleteMany({ organizationId: { $in: orgIds } }),
      Invoice.deleteMany({ organizationId: { $in: orgIds } }),
      Meeting.deleteMany({ organizationId: { $in: orgIds } }),
      ActivityLog.deleteMany({ organizationId: { $in: orgIds } }),
      Category.deleteMany({ organizationId: { $in: orgIds } }),
      Subscription.deleteMany({ userId: target._id }),
      WhatsappFeature.deleteMany({ superadminId: target._id }),
      Purchase.deleteMany({ userId: target._id }),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Superadmin account and all associated data permanently deleted.',
    });
  } catch (error) {
    console.error('deleteSuperadminAccount error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete account.' });
  }
};

/**
 * GET /api/v1/superadmin/logs?type=api|email|whatsapp&page=1&limit=50
 */
export const getLogs = async (req, res) => {
  try {
    const { type, page = 1, limit = 50, success } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (success !== undefined) filter.success = success === 'true';

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      ActivityLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      ActivityLog.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        logs,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
          limit: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error('SuperAdmin logs error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch logs.' });
  }
};

/**
 * GET /api/v1/superadmin/payments?status=paid|pending|failed&page=1&limit=20
 * Returns Purchase records (payments from landing page). Product owner only.
 */
export const getPayments = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [purchases, total] = await Promise.all([
      Purchase.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Purchase.countDocuments(filter),
    ]);

    const [totalRevenue, paidCount, pendingCount, failedCount] = await Promise.all([
      Purchase.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Purchase.countDocuments({ status: 'paid' }),
      Purchase.countDocuments({ status: 'pending' }),
      Purchase.countDocuments({ status: 'failed' }),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        purchases,
        summary: {
          totalRevenue: totalRevenue[0]?.total || 0,
          paid: paidCount,
          pending: pendingCount,
          failed: failedCount,
        },
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
          limit: parseInt(limit),
        },
      },
    });
  } catch (error) {
    console.error('SuperAdmin payments error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch payment records.' });
  }
};
