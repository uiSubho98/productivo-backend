import Task from '../models/Task.js';
import TaskTimeLog from '../models/TaskTimeLog.js';
import AttendanceEntry from '../models/AttendanceEntry.js';

function localDateKey(d = new Date()) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// POST /api/v1/tasks/:id/timer/start
// Starts a timer. Fails if the user already has a running timer on ANY task.
export const startTimer = async (req, res) => {
  try {
    const taskId = req.params.id;
    const user = req.user;

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });

    // Must be clocked in today to start a task timer
    const attendance = await AttendanceEntry.findOne({
      userId: user._id,
      date: localDateKey(),
    });
    if (!attendance?.loginAt) {
      return res.status(403).json({
        success: false,
        error: 'Please clock in on the Attendance page before starting a task timer.',
        code: 'NOT_CLOCKED_IN',
      });
    }

    if (task.activeTimerBy) {
      if (String(task.activeTimerBy) === String(user._id)) {
        return res.status(400).json({
          success: false,
          error: 'You already have a timer running on this task.',
        });
      }
      return res.status(409).json({
        success: false,
        error: 'Another user has a timer running on this task.',
      });
    }

    // Block if the user has ANY running timer elsewhere
    const existing = await TaskTimeLog.findOne({ userId: user._id, endedAt: null }).lean();
    if (existing) {
      return res.status(400).json({
        success: false,
        error: 'You already have a running timer on another task. Stop it first.',
        data: { activeTaskId: existing.taskId },
      });
    }

    const now = new Date();
    await TaskTimeLog.create({
      taskId: task._id,
      userId: user._id,
      organizationId: task.organizationId,
      startedAt: now,
      endedAt: null,
      durationMs: 0,
    });

    task.activeTimerBy = user._id;
    task.activeTimerStartedAt = now;
    await task.save();

    return res.status(200).json({
      success: true,
      data: {
        startedAt: now,
        totalTimeMs: task.totalTimeMs,
      },
    });
  } catch (err) {
    console.error('startTimer error:', err);
    return res.status(500).json({ success: false, error: 'Failed to start timer.' });
  }
};

// POST /api/v1/tasks/:id/timer/stop
// Body: { note?: string }
export const stopTimer = async (req, res) => {
  try {
    const taskId = req.params.id;
    const user = req.user;
    const note = (req.body?.note || '').toString().trim().slice(0, 300);

    const task = await Task.findById(taskId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });

    if (!task.activeTimerBy || String(task.activeTimerBy) !== String(user._id)) {
      return res.status(400).json({
        success: false,
        error: 'No timer of yours is running on this task.',
      });
    }

    const log = await TaskTimeLog.findOne({
      taskId: task._id,
      userId: user._id,
      endedAt: null,
    }).sort({ startedAt: -1 });

    if (!log) {
      // Defensive: clear inconsistent task flags
      task.activeTimerBy = null;
      task.activeTimerStartedAt = null;
      await task.save();
      return res.status(400).json({ success: false, error: 'No active log entry found.' });
    }

    const now = new Date();
    log.endedAt = now;
    log.durationMs = Math.max(0, now - log.startedAt);
    if (note) log.note = note;
    await log.save();

    task.totalTimeMs = (task.totalTimeMs || 0) + log.durationMs;
    task.activeTimerBy = null;
    task.activeTimerStartedAt = null;
    await task.save();

    return res.status(200).json({
      success: true,
      data: {
        durationMs: log.durationMs,
        totalTimeMs: task.totalTimeMs,
      },
    });
  } catch (err) {
    console.error('stopTimer error:', err);
    return res.status(500).json({ success: false, error: 'Failed to stop timer.' });
  }
};

// GET /api/v1/tasks/:id/timer
// Returns { running: bool, byUserId, startedAt, totalTimeMs, youAreRunning }
export const getTimerState = async (req, res) => {
  try {
    const task = await Task.findById(req.params.id)
      .select('activeTimerBy activeTimerStartedAt totalTimeMs')
      .lean();
    if (!task) return res.status(404).json({ success: false, error: 'Task not found.' });

    return res.status(200).json({
      success: true,
      data: {
        running: !!task.activeTimerBy,
        byUserId: task.activeTimerBy || null,
        startedAt: task.activeTimerStartedAt,
        totalTimeMs: task.totalTimeMs || 0,
        youAreRunning: String(task.activeTimerBy) === String(req.user._id),
      },
    });
  } catch (err) {
    console.error('getTimerState error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load timer state.' });
  }
};

// GET /api/v1/tasks/:id/time-logs
export const listTaskLogs = async (req, res) => {
  try {
    const logs = await TaskTimeLog.find({ taskId: req.params.id })
      .populate('userId', 'name email')
      .sort({ startedAt: -1 })
      .limit(500)
      .lean();
    return res.status(200).json({ success: true, data: logs });
  } catch (err) {
    console.error('listTaskLogs error:', err);
    return res.status(500).json({ success: false, error: 'Failed to load time logs.' });
  }
};
