import mongoose from 'mongoose';
import ActivityLog from '../models/ActivityLog.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Invoice from '../models/Invoice.js';
import Meeting from '../models/Meeting.js';
import Task from '../models/Task.js';
import Project from '../models/Project.js';
import Client from '../models/Client.js';
import { getDailyCount } from '../services/whatsappService.js';
import { getLocationUsage } from '../routes/location.js';

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
    ] = await Promise.all([
      User.countDocuments(),
      Organization.countDocuments(),
      Invoice.countDocuments(),
      Meeting.countDocuments(),
      Task.countDocuments(),
      Project.countDocuments(),
      Client.countDocuments(),
      ActivityLog.countDocuments(),
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

    // ── Per-org breakdown ─────────────────────────────────────────────────────
    const orgs = await Organization.find().select('name').lean();
    const orgStats = await Promise.all(
      orgs.map(async (org) => {
        const [users, meetings, invoices, tasks] = await Promise.all([
          User.countDocuments({ organizationId: org._id }),
          Meeting.countDocuments({ organizationId: org._id }),
          Invoice.countDocuments({ organizationId: org._id }),
          Task.countDocuments({ organizationId: org._id }),
        ]);
        const emailsSent = await ActivityLog.countDocuments({
          type: 'email',
          success: true,
          organizationId: org._id,
          createdAt: { $gte: startOfMonth },
        });
        const waSent = await ActivityLog.countDocuments({
          type: 'whatsapp',
          success: true,
          organizationId: org._id,
          createdAt: { $gte: startOfMonth },
        });
        return { orgId: org._id, name: org.name, users, meetings, invoices, tasks, emailsSent, waSent };
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
        orgStats,
        location: getLocationUsage(),
      },
    });
  } catch (error) {
    console.error('SuperAdmin overview error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch overview.' });
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
