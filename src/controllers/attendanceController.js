import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import AttendanceEntry from '../models/AttendanceEntry.js';
import TaskTimeLog from '../models/TaskTimeLog.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Task from '../models/Task.js';

/**
 * Close any running task timers for a user at a given moment.
 * Used by both manual clock-out and the midnight cron.
 * Returns the number of timers stopped.
 */
export async function stopUserRunningTimers(userId, at, { systemStopped = false } = {}) {
  const runningLogs = await TaskTimeLog.find({ userId, endedAt: null });
  let stopped = 0;
  for (const log of runningLogs) {
    const endAt = at instanceof Date ? at : new Date(at);
    const startMs = new Date(log.startedAt).getTime();
    const durationMs = Math.max(0, endAt.getTime() - startMs);
    log.endedAt = endAt;
    log.durationMs = durationMs;
    if (systemStopped) log.systemStopped = true;
    await log.save();

    // Update cached totals on the task
    await Task.updateOne(
      { _id: log.taskId },
      {
        $inc: { totalTimeMs: durationMs },
        $set: { activeTimerBy: null, activeTimerStartedAt: null },
      }
    );
    stopped++;
  }
  return stopped;
}

function localDateKey(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6; // Sun = 0, Sat = 6
}

function msToHHMM(ms) {
  if (!ms || ms < 0) return '0h 0m';
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

async function resolveAdminOrgIds(user) {
  if (user.role === 'superadmin') {
    const orgs = await Organization.find({ superadminId: user._id }).select('_id').lean();
    return orgs.map((o) => o._id);
  }
  if (user.role === 'org_admin' && user.organizationId) return [user.organizationId];
  return [];
}

// POST /api/v1/attendance/clock-in
export const clockIn = async (req, res) => {
  try {
    const user = req.user;
    if (!user.organizationId) return res.status(400).json({ success: false, error: 'No organization linked.' });
    const date = localDateKey();

    const entry = await AttendanceEntry.findOneAndUpdate(
      { userId: user._id, date },
      {
        $setOnInsert: {
          userId: user._id,
          organizationId: user.organizationId,
          date,
          totalDurationMs: 0,
          sessions: [],
        },
      },
      { upsert: true, new: true }
    );

    if (entry.loginAt) {
      return res.status(400).json({
        success: false,
        error: 'You are already clocked in. Clock out first.',
        data: entry,
      });
    }

    entry.loginAt = new Date();
    await entry.save();
    return res.status(200).json({ success: true, data: entry });
  } catch (err) {
    console.error('clockIn error:', err);
    return res.status(500).json({ success: false, error: 'Failed to clock in.' });
  }
};

// POST /api/v1/attendance/clock-out
export const clockOut = async (req, res) => {
  try {
    const user = req.user;
    const date = localDateKey();
    const entry = await AttendanceEntry.findOne({ userId: user._id, date });

    if (!entry || !entry.loginAt) {
      return res.status(400).json({
        success: false,
        error: 'No active session to clock out.',
      });
    }

    const endAt = new Date();
    const startAt = entry.loginAt;
    const durationMs = Math.max(0, endAt - startAt);

    entry.sessions.push({ startAt, endAt, durationMs, systemCheckout: false });
    entry.totalDurationMs = (entry.totalDurationMs || 0) + durationMs;
    entry.loginAt = null;
    await entry.save();

    // User-initiated clock-out — also stop any timers that are still running
    // (user chose to leave; don't flag as systemStopped since it's voluntary).
    const stoppedTimers = await stopUserRunningTimers(user._id, endAt, { systemStopped: false });

    return res.status(200).json({ success: true, data: entry, stoppedTimers });
  } catch (err) {
    console.error('clockOut error:', err);
    return res.status(500).json({ success: false, error: 'Failed to clock out.' });
  }
};

// GET /api/v1/attendance/me/today
export const myToday = async (req, res) => {
  try {
    const entry = await AttendanceEntry.findOne({
      userId: req.user._id,
      date: localDateKey(),
    });
    return res.status(200).json({ success: true, data: entry || null });
  } catch (err) {
    console.error('myToday error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load attendance.' });
  }
};

// GET /api/v1/attendance/me?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns the user's own attendance history (default: current month).
export const myHistory = async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { userId: req.user._id };
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    } else {
      const d = new Date();
      const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      filter.date = { $gte: monthStart };
    }
    const entries = await AttendanceEntry.find(filter).sort({ date: -1 }).lean();
    return res.status(200).json({ success: true, data: entries });
  } catch (err) {
    console.error('myHistory error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load history.' });
  }
};

// GET /api/v1/attendance?from=&to=&userId=
// Admin view (superadmin / org_admin). Scoped to their org(s).
export const adminList = async (req, res) => {
  try {
    const orgIds = await resolveAdminOrgIds(req.user);
    if (!orgIds.length) return res.status(403).json({ success: false, error: 'Admin only.' });

    const { from, to, userId } = req.query;
    const filter = { organizationId: { $in: orgIds } };
    if (userId && mongoose.Types.ObjectId.isValid(userId)) filter.userId = userId;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    } else {
      const d = new Date();
      const monthStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      filter.date = { $gte: monthStart };
    }

    const entries = await AttendanceEntry.find(filter)
      .populate('userId', 'name email role')
      .sort({ date: -1 })
      .limit(2000)
      .lean();

    // Attach task-time totals per user per date — useful for the admin sheet
    const userDatePairs = entries.map((e) => ({ userId: e.userId?._id, date: e.date }));

    // Build a per-user-per-date task-time map via a single aggregation
    let taskTimeMap = {};
    if (userDatePairs.length > 0) {
      const userIdsInvolved = [...new Set(entries.map((e) => e.userId?._id?.toString()).filter(Boolean))];
      const minDate = [...new Set(entries.map((e) => e.date))].sort()[0];
      const maxDate = [...new Set(entries.map((e) => e.date))].sort().slice(-1)[0];

      const startDate = new Date(minDate + 'T00:00:00');
      const endDate = new Date(maxDate + 'T23:59:59.999');

      const agg = await TaskTimeLog.aggregate([
        {
          $match: {
            userId: { $in: userIdsInvolved.map((id) => new mongoose.Types.ObjectId(id)) },
            endedAt: { $ne: null, $gte: startDate, $lte: endDate },
          },
        },
        {
          $project: {
            userId: 1,
            durationMs: 1,
            date: { $dateToString: { format: '%Y-%m-%d', date: '$endedAt' } },
          },
        },
        {
          $group: {
            _id: { userId: '$userId', date: '$date' },
            totalTaskMs: { $sum: '$durationMs' },
            taskLogCount: { $sum: 1 },
          },
        },
      ]);

      for (const row of agg) {
        const key = `${row._id.userId}_${row._id.date}`;
        taskTimeMap[key] = { totalTaskMs: row.totalTaskMs, taskLogCount: row.taskLogCount };
      }
    }

    const enriched = entries.map((e) => {
      const key = `${e.userId?._id}_${e.date}`;
      const tt = taskTimeMap[key] || { totalTaskMs: 0, taskLogCount: 0 };
      const d = new Date(e.date + 'T00:00:00');
      return {
        ...e,
        weekend: isWeekend(d),
        dayOfWeek: d.toLocaleDateString('en-IN', { weekday: 'short' }),
        taskTotalMs: tt.totalTaskMs,
        taskLogCount: tt.taskLogCount,
      };
    });

    return res.status(200).json({ success: true, data: enriched });
  } catch (err) {
    console.error('adminList error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load attendance.' });
  }
};

// GET /api/v1/attendance/export?from=&to=&userId=
// Returns an Excel file with attendance + per-task time breakdown.
export const exportExcel = async (req, res) => {
  try {
    const orgIds = await resolveAdminOrgIds(req.user);
    if (!orgIds.length) return res.status(403).json({ success: false, error: 'Admin only.' });

    const { from, to, userId } = req.query;
    const filter = { organizationId: { $in: orgIds } };
    if (userId && mongoose.Types.ObjectId.isValid(userId)) filter.userId = userId;
    if (from) filter.date = { ...(filter.date || {}), $gte: from };
    if (to) filter.date = { ...(filter.date || {}), $lte: to };

    const entries = await AttendanceEntry.find(filter)
      .populate('userId', 'name email')
      .sort({ date: 1 })
      .lean();

    // Per (user, date) task breakdown
    const userIds = [...new Set(entries.map((e) => e.userId?._id?.toString()).filter(Boolean))];
    const dateRange = { from, to };
    const taskFilter = {
      userId: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) },
      endedAt: { $ne: null },
    };
    if (from) taskFilter.endedAt.$gte = new Date(from + 'T00:00:00');
    if (to) taskFilter.endedAt.$lte = new Date(to + 'T23:59:59.999');

    const taskLogs = await TaskTimeLog.find(taskFilter)
      .populate('taskId', 'title')
      .populate('userId', 'name')
      .sort({ endedAt: 1 })
      .lean();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Productivo';
    workbook.created = new Date();

    // Sheet 1: Attendance
    const attSheet = workbook.addWorksheet('Attendance');
    attSheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Day', key: 'day', width: 8 },
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'First Login', key: 'first', width: 12 },
      { header: 'Last Logout', key: 'last', width: 12 },
      { header: 'Sessions', key: 'sessionCount', width: 10 },
      { header: 'Work Duration', key: 'duration', width: 16 },
      { header: 'Auto Checkout', key: 'autoCheckout', width: 14 },
      { header: 'Weekend', key: 'weekend', width: 10 },
    ];
    attSheet.getRow(1).font = { bold: true };
    attSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    attSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    for (const e of entries) {
      const d = new Date(e.date + 'T00:00:00');
      const first = e.sessions?.[0]?.startAt;
      const last = e.sessions?.[e.sessions.length - 1]?.endAt || e.loginAt;
      const autoCheckout = e.sessions?.some((s) => s.systemCheckout);
      attSheet.addRow({
        date: e.date,
        day: d.toLocaleDateString('en-IN', { weekday: 'short' }),
        name: e.userId?.name || '',
        email: e.userId?.email || '',
        first: first ? new Date(first).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—',
        last: last ? new Date(last).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : (e.loginAt ? 'Active' : '—'),
        sessionCount: e.sessions?.length || 0,
        duration: msToHHMM(e.totalDurationMs),
        autoCheckout: autoCheckout ? 'Yes' : '',
        weekend: isWeekend(d) ? 'Yes' : '',
      });
    }

    // Sheet 2: Task Time Breakdown
    const taskSheet = workbook.addWorksheet('Task Time');
    taskSheet.columns = [
      { header: 'Date',        key: 'date',         width: 12 },
      { header: 'User',        key: 'user',         width: 24 },
      { header: 'Task',        key: 'task',         width: 40 },
      { header: 'Started',     key: 'started',      width: 18 },
      { header: 'Ended',       key: 'ended',        width: 18 },
      { header: 'Duration',    key: 'duration',     width: 12 },
      { header: 'Auto Stopped', key: 'autoStopped', width: 14 },
      { header: 'Note',        key: 'note',         width: 30 },
    ];
    taskSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    taskSheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };

    for (const log of taskLogs) {
      taskSheet.addRow({
        date: localDateKey(new Date(log.endedAt)),
        user: log.userId?.name || '',
        task: log.taskId?.title || '(deleted)',
        started: new Date(log.startedAt).toLocaleString('en-IN'),
        ended: new Date(log.endedAt).toLocaleString('en-IN'),
        duration: msToHHMM(log.durationMs),
        autoStopped: log.systemStopped ? 'Yes' : '',
        note: log.note || '',
      });
    }

    const filename = `timesheet_${from || 'all'}_to_${to || 'now'}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('exportExcel error:', err);
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Failed to export.' });
  }
};

// GET /api/v1/attendance/members — admin: list org members to filter by
export const listMembers = async (req, res) => {
  try {
    const orgIds = await resolveAdminOrgIds(req.user);
    if (!orgIds.length) return res.status(403).json({ success: false, error: 'Admin only.' });

    const members = await User.find({
      organizationId: { $in: orgIds },
      isActive: true,
      role: { $in: ['superadmin', 'org_admin', 'employee'] },
    })
      .select('name email role')
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({ success: true, data: members });
  } catch (err) {
    console.error('listMembers error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load members.' });
  }
};
