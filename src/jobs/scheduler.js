import cron from 'node-cron';
import Task from '../models/Task.js';
import Meeting from '../models/Meeting.js';
import User from '../models/User.js';
import AttendanceEntry from '../models/AttendanceEntry.js';
import TaskTimeLog from '../models/TaskTimeLog.js';
import { sendEmail } from '../services/emailService.js';
import { sendMessage } from '../services/whatsappService.js';
import { isWhatsappEnabledForOrg } from '../services/whatsappFeatureService.js';
import { refreshAccessToken, checkTokenHealth } from '../config/googleAuth.js';

/**
 * Refresh Google access token every 45 minutes.
 */
const scheduleTokenRefresh = () => {
  refreshAccessToken().then((result) => {
    if (result.success) console.log('[CRON] Initial Google token refresh successful');
  });

  cron.schedule('*/45 * * * *', async () => {
    console.log('[CRON] Refreshing Google access token...');
    await refreshAccessToken();
  });

  cron.schedule('0 */6 * * *', async () => {
    console.log('[CRON] Google token health check...');
    await checkTokenHealth();
  });
};

/**
 * 5-minute meeting reminder — runs every minute, notifies attendees whose
 * meeting starts in 5–6 minutes (to avoid double-sending across ticks).
 * Sends both email and WhatsApp.
 */
const checkFiveMinuteMeetingReminders = () => {
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const fiveMin = new Date(now.getTime() + 5 * 60 * 1000);
      const sixMin = new Date(now.getTime() + 6 * 60 * 1000);

      const meetings = await Meeting.find({
        status: 'scheduled',
        scheduledAt: { $gte: fiveMin, $lte: sixMin },
      });

      for (const meeting of meetings) {
        const timeStr = meeting.scheduledAt.toLocaleString('en-IN', {
          timeStyle: 'short',
          timeZone: 'Asia/Kolkata',
        });
        const subject = `⏰ Starting in 5 minutes: ${meeting.title}`;
        const html = `
          <h3>${meeting.title}</h3>
          <p>Your meeting starts in <strong>5 minutes</strong> at ${timeStr}.</p>
          ${meeting.meetLink ? `<p><a href="${meeting.meetLink}">Join Now</a></p>` : ''}
        `;
        const waText = `⏰ Meeting in 5 min: ${meeting.title}\nAt: ${timeStr}${meeting.meetLink ? `\nJoin: ${meeting.meetLink}` : ''}`;

        // Check WA feature flag once per meeting (same org for all attendees)
        const { enabled: waEnabled5 } = await isWhatsappEnabledForOrg(meeting.organizationId).catch(() => ({ enabled: false }));

        for (const attendee of meeting.attendees) {
          if (attendee.email) {
            await sendEmail(attendee.email, subject, html).catch(() => {});
          }
          if (attendee.whatsapp && waEnabled5) {
            await sendMessage(attendee.whatsapp, waText).catch(() => {});
          }
        }
      }

      if (meetings.length > 0) {
        console.log(`[CRON] 5-min reminders sent for ${meetings.length} meetings.`);
      }
    } catch (error) {
      console.error('[CRON] 5-min meeting reminder error:', error.message);
    }
  });
};

/**
 * 1-hour meeting reminder — existing hourly job, now also sends WhatsApp.
 */
const checkMeetingReminders = () => {
  cron.schedule('0 * * * *', async () => {
    console.log('[CRON] Checking 1-hour meeting reminders...');
    try {
      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
      const twoHoursLater = new Date(now.getTime() + 120 * 60 * 1000);

      const meetings = await Meeting.find({
        status: 'scheduled',
        scheduledAt: { $gte: oneHourLater, $lte: twoHoursLater },
      });

      for (const meeting of meetings) {
        const dateStr = meeting.scheduledAt.toLocaleString('en-IN', {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'Asia/Kolkata',
        });
        const subject = `Upcoming Meeting in 1 Hour: ${meeting.title}`;
        const html = `
          <h3>${meeting.title}</h3>
          <p>Your meeting starts in <strong>1 hour</strong>.</p>
          <p><strong>When:</strong> ${dateStr}</p>
          ${meeting.meetLink ? `<p><strong>Join:</strong> <a href="${meeting.meetLink}">${meeting.meetLink}</a></p>` : ''}
        `;
        const waText = `📅 Meeting in 1 hour: ${meeting.title}\nAt: ${dateStr}${meeting.meetLink ? `\nJoin: ${meeting.meetLink}` : ''}`;

        const { enabled: waEnabled1h } = await isWhatsappEnabledForOrg(meeting.organizationId).catch(() => ({ enabled: false }));
        for (const attendee of meeting.attendees) {
          if (attendee.email) await sendEmail(attendee.email, subject, html).catch(() => {});
          if (attendee.whatsapp && waEnabled1h) await sendMessage(attendee.whatsapp, waText).catch(() => {});
        }
      }

      console.log(`[CRON] 1-hour meeting reminders sent for ${meetings.length} meetings.`);
    } catch (error) {
      console.error('[CRON] Meeting reminder error:', error.message);
    }
  });
};

/**
 * Daily task due-date reminder at midnight IST (18:30 UTC).
 * Notifies assignees of tasks due tomorrow.
 */
const checkTaskDueTomorrow = () => {
  // Midnight IST = 18:30 UTC
  cron.schedule('30 18 * * *', async () => {
    console.log('[CRON] Checking tasks due tomorrow...');
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const tomorrowStart = new Date(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate() + 1);
      const tomorrowEnd = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000 - 1);

      const tasks = await Task.find({
        status: { $nin: ['done', 'completed'] },
        dueDate: { $gte: tomorrowStart, $lte: tomorrowEnd },
      }).populate('assignees', 'name email whatsapp');

      for (const task of tasks) {
        const dueDateStr = new Date(task.dueDate).toLocaleDateString('en-IN', {
          dateStyle: 'medium',
          timeZone: 'Asia/Kolkata',
        });
        const subject = `Task Due Tomorrow: ${task.title}`;
        const html = `
          <h3>Task Due Tomorrow</h3>
          <p>The task <strong>"${task.title}"</strong> is due on <strong>${dueDateStr}</strong>.</p>
          <p>Please complete it on time.</p>
        `;
        const waText = `📋 Task due tomorrow: ${task.title}\nDue: ${dueDateStr}\nPlease complete it on time.`;

        const { enabled: waEnabledTomorrow } = await isWhatsappEnabledForOrg(task.organizationId).catch(() => ({ enabled: false }));
        for (const assignee of (task.assignees || [])) {
          if (assignee.email) await sendEmail(assignee.email, subject, html).catch(() => {});
          if (assignee.whatsapp && waEnabledTomorrow) await sendMessage(assignee.whatsapp, waText).catch(() => {});
        }
      }

      console.log(`[CRON] Due-tomorrow reminders sent for ${tasks.length} tasks.`);
    } catch (error) {
      console.error('[CRON] Task due-tomorrow reminder error:', error.message);
    }
  });
};

/**
 * Overdue reminder at 9:00 AM IST (03:30 UTC).
 * Sends email + WhatsApp for all overdue tasks.
 */
const checkOverdueReminders = () => {
  // 9 AM IST = 03:30 UTC
  cron.schedule('30 3 * * *', async () => {
    console.log('[CRON] Checking overdue reminders...');
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const todayStart = new Date(nowIST.getFullYear(), nowIST.getMonth(), nowIST.getDate());

      const overdueTasks = await Task.find({
        status: { $nin: ['done', 'completed'] },
        dueDate: { $lt: todayStart },
      }).populate('assignees', 'name email whatsapp');

      for (const task of overdueTasks) {
        const dueDateStr = new Date(task.dueDate).toLocaleDateString('en-IN', {
          dateStyle: 'medium',
          timeZone: 'Asia/Kolkata',
        });
        const subject = `⚠️ Overdue Task: ${task.title}`;
        const html = `
          <h3>Overdue Task Alert</h3>
          <p>The task <strong>"${task.title}"</strong> was due on <strong>${dueDateStr}</strong> and is still open.</p>
          <p>Please update it immediately or extend the deadline.</p>
        `;
        const waText = `⚠️ Overdue task: ${task.title}\nWas due: ${dueDateStr}\nPlease complete or update the deadline.`;

        const { enabled: waEnabledOverdue } = await isWhatsappEnabledForOrg(task.organizationId).catch(() => ({ enabled: false }));
        for (const assignee of (task.assignees || [])) {
          if (assignee.email) await sendEmail(assignee.email, subject, html).catch(() => {});
          if (assignee.whatsapp && waEnabledOverdue) await sendMessage(assignee.whatsapp, waText).catch(() => {});
        }
      }

      console.log(`[CRON] Overdue reminders sent for ${overdueTasks.length} tasks.`);
    } catch (error) {
      console.error('[CRON] Overdue reminder error:', error.message);
    }
  });
};

/**
 * Midnight IST — force-close any forgotten clock-ins and running task timers.
 * Fires at 00:00 Asia/Kolkata. Stamps systemCheckout / systemStopped so the
 * user and admin can see in the timesheet that it was auto-closed.
 */
const checkoutForgottenSessions = () => {
  cron.schedule(
    '0 0 * * *',
    async () => {
      try {
        console.log('[CRON] Midnight IST — closing forgotten attendance + timers…');

        // End at the exact moment the cron fires — "the day" ends here.
        const closeAt = new Date();

        // 1. Auto-close attendance entries that have a running loginAt
        const openEntries = await AttendanceEntry.find({ loginAt: { $ne: null } });
        for (const entry of openEntries) {
          const startAt = entry.loginAt;
          const durationMs = Math.max(0, closeAt - startAt);
          entry.sessions.push({
            startAt,
            endAt: closeAt,
            durationMs,
            systemCheckout: true,
          });
          entry.totalDurationMs = (entry.totalDurationMs || 0) + durationMs;
          entry.loginAt = null;
          await entry.save();
        }

        // 2. Auto-stop any running task timers
        const runningLogs = await TaskTimeLog.find({ endedAt: null });
        let stoppedCount = 0;
        for (const log of runningLogs) {
          const durationMs = Math.max(0, closeAt - log.startedAt);
          log.endedAt = closeAt;
          log.durationMs = durationMs;
          log.systemStopped = true;
          await log.save();
          await Task.updateOne(
            { _id: log.taskId },
            {
              $inc: { totalTimeMs: durationMs },
              $set: { activeTimerBy: null, activeTimerStartedAt: null },
            }
          );
          stoppedCount++;
        }

        console.log(
          `[CRON] Midnight IST: auto-checked-out ${openEntries.length} user(s), auto-stopped ${stoppedCount} timer(s).`
        );
      } catch (err) {
        console.error('[CRON] Midnight checkout error:', err.message);
      }
    },
    { timezone: 'Asia/Kolkata' }
  );
};

/**
 * Initialize all cron jobs.
 */
export const startScheduler = () => {
  console.log('Cron scheduler started.');
  scheduleTokenRefresh();
  checkFiveMinuteMeetingReminders();
  checkMeetingReminders();
  checkTaskDueTomorrow();
  checkOverdueReminders();
  checkoutForgottenSessions();
};

export default startScheduler;
