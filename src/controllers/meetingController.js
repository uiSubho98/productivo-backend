import Meeting from '../models/Meeting.js';
import Organization from '../models/Organization.js';
import Client from '../models/Client.js';
import User from '../models/User.js';
import Project from '../models/Project.js';
import { createEvent } from '../services/calendarService.js';
import { generateMeetingNotesPdf } from '../services/pdfService.js';
import { uploadFile } from '../services/storageService.js';
import { sendEmail } from '../services/emailService.js';
import { sendMessage } from '../services/whatsappService.js';

/**
 * Send meeting notifications (email + whatsapp) to all attendees.
 * Runs async — does not block the response.
 */
async function notifyAttendees(attendees, title, dateStr, duration, meetLink, orgName) {
  const results = { emailsSent: 0, whatsappSent: 0, errors: [] };

  for (const attendee of attendees) {
    // Email
    if (attendee.email) {
      try {
        await sendEmail(
          attendee.email,
          `Meeting Invite: ${title}`,
          `<h3>${title}</h3>
          <p>Hi ${attendee.name || 'there'},</p>
          <p>You've been invited to a meeting.</p>
          <p><strong>When:</strong> ${dateStr}</p>
          <p><strong>Duration:</strong> ${duration} minutes</p>
          ${meetLink ? `<p><strong>Join:</strong> <a href="${meetLink}">${meetLink}</a></p>` : ''}
          <br/><p>— ${orgName}</p>`
        );
        results.emailsSent++;
        console.log(`[Meeting] Email sent to ${attendee.email}`);
      } catch (err) {
        console.error(`[Meeting] Email failed for ${attendee.email}:`, err.message);
        results.errors.push({ type: 'email', to: attendee.email, error: err.message });
      }
    }

    // WhatsApp
    if (attendee.whatsapp) {
      try {
        await sendMessage(
          attendee.whatsapp,
          `Meeting: ${title}\nWhen: ${dateStr}\nDuration: ${duration} min${meetLink ? `\nJoin: ${meetLink}` : ''}\n\n— ${orgName}`
        );
        results.whatsappSent++;
        console.log(`[Meeting] WhatsApp sent to ${attendee.whatsapp}`);
      } catch (err) {
        console.error(`[Meeting] WhatsApp failed for ${attendee.whatsapp}:`, err.message);
        results.errors.push({ type: 'whatsapp', to: attendee.whatsapp, error: err.message });
      }
    }
  }

  console.log(`[Meeting] Notifications: ${results.emailsSent} emails, ${results.whatsappSent} whatsapp sent`);
  return results;
}

export const create = async (req, res) => {
  try {
    const { title, description, meetingType, projectId, clientId, attendees, scheduledAt, duration, recurrence, recurrenceDays, recurrenceEndDate } = req.body;

    const startTime = new Date(scheduledAt);
    const endTime = new Date(startTime.getTime() + (duration || 60) * 60000);

    // Build final attendees list
    let finalAttendees = [...(attendees || [])];

    // Auto-add creator as organizer (fetch full user to get whatsapp)
    const creator = await User.findById(req.user._id).select('email name whatsapp');
    const creatorAlreadyAdded = finalAttendees.some(
      (a) => a.email?.toLowerCase() === creator.email?.toLowerCase()
    );
    if (!creatorAlreadyAdded) {
      finalAttendees.unshift({
        email: creator.email,
        name: creator.name,
        whatsapp: creator.whatsapp || null,
        type: 'organizer',
      });
    }

    // Auto-fetch client email + whatsapp if client meeting
    if (clientId) {
      const client = await Client.findById(clientId);
      if (client && client.email) {
        const clientAlreadyAdded = finalAttendees.some(
          (a) => a.email?.toLowerCase() === client.email?.toLowerCase()
        );
        if (!clientAlreadyAdded) {
          finalAttendees.push({
            email: client.email,
            name: client.name,
            whatsapp: client.whatsappNumber
              ? `${client.countryCode || '+91'}${client.whatsappNumber}`.replace(/^\+\+/, '+')
              : null,
            type: 'client',
          });
        }
      }
    }

    // Auto-add all project members (employees, clients, maintainers) when project meeting
    if (projectId) {
      const project = await Project.findById(projectId).lean();
      if (project && project.members && project.members.length > 0) {
        for (const member of project.members) {
          if (!member.email && !member.whatsappNumber) continue;

          const alreadyAdded = finalAttendees.some(
            (a) =>
              (member.email && a.email?.toLowerCase() === member.email.toLowerCase()) ||
              (member.whatsappNumber && a.whatsapp === member.whatsappNumber)
          );

          if (!alreadyAdded) {
            finalAttendees.push({
              email: member.email || '',
              name: member.name,
              whatsapp: member.whatsappNumber
                ? `${member.countryCode || '+91'}${member.whatsappNumber}`.replace(/^\+\+/, '+')
                : null,
              type: member.role,
            });
          }
        }
        console.log(`[Meeting] Auto-added ${project.members.length} project members for "${project.name}"`);
      }
    }

    console.log(`[Meeting] Creating "${title}" with ${finalAttendees.length} attendees`);

    // Google Calendar + Meet link (don't let this block meeting creation)
    let googleCalendarEventId = null;
    let meetLink = null;

    try {
      const calendarResult = await createEvent(title, description || '', startTime, endTime, finalAttendees);
      googleCalendarEventId = calendarResult.eventId;
      meetLink = calendarResult.meetLink;
      console.log(`[Meeting] Google Meet link: ${meetLink}`);
    } catch (calErr) {
      console.warn('[Meeting] Google Calendar failed:', calErr.message);
    }

    // Save meeting
    const meeting = await Meeting.create({
      title,
      description,
      meetingType: meetingType || (clientId ? 'client' : 'personal'),
      organizationId: req.user.organizationId,
      projectId: projectId || null,
      clientId: clientId || null,
      attendees: finalAttendees,
      scheduledAt: startTime,
      duration: duration || 60,
      googleCalendarEventId,
      meetLink,
      recurrence: recurrence || 'none',
      recurrenceDays: recurrenceDays || [],
      recurrenceEndDate: recurrenceEndDate || null,
    });

    // Send notifications AFTER saving (don't await - fire and forget but with logging)
    const org = await Organization.findById(req.user.organizationId);
    const orgName = org?.name || 'Your Organization';
    const dateStr = startTime.toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    });

    // Fire notifications async — don't block response
    notifyAttendees(finalAttendees, title, dateStr, duration || 60, meetLink, orgName)
      .then((results) => {
        console.log(`[Meeting] All notifications done for "${title}"`);
      })
      .catch((err) => {
        console.error(`[Meeting] Notification batch error:`, err.message);
      });

    return res.status(201).json({
      success: true,
      data: meeting,
      message: `Meeting created. Sending notifications to ${finalAttendees.length} attendees.`,
    });
  } catch (error) {
    console.error('Create meeting error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create meeting.',
    });
  }
};

export const getAll = async (req, res) => {
  try {
    const { status, projectId, clientId, meetingType } = req.query;
    const filter = { organizationId: req.user.organizationId };

    if (status) filter.status = status;
    if (projectId) filter.projectId = projectId;
    if (clientId) filter.clientId = clientId;
    if (meetingType) filter.meetingType = meetingType;

    const meetings = await Meeting.find(filter)
      .populate('projectId', 'name')
      .populate('clientId', 'name')
      .sort({ scheduledAt: -1 });

    return res.status(200).json({ success: true, data: meetings });
  } catch (error) {
    console.error('Get meetings error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch meetings.' });
  }
};

export const getById = async (req, res) => {
  try {
    const meeting = await Meeting.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId,
    })
      .populate('projectId', 'name')
      .populate('clientId', 'name email whatsappNumber phoneNumber');

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found.' });
    }

    return res.status(200).json({ success: true, data: meeting });
  } catch (error) {
    console.error('Get meeting error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch meeting.' });
  }
};

export const update = async (req, res) => {
  try {
    const { title, description, attendees, scheduledAt, duration, status, notes, recurrence, recurrenceDays, recurrenceEndDate } = req.body;
    const updateData = {};

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (attendees !== undefined) updateData.attendees = attendees;
    if (scheduledAt !== undefined) updateData.scheduledAt = scheduledAt;
    if (duration !== undefined) updateData.duration = duration;
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (recurrence !== undefined) updateData.recurrence = recurrence;
    if (recurrenceDays !== undefined) updateData.recurrenceDays = recurrenceDays;
    if (recurrenceEndDate !== undefined) updateData.recurrenceEndDate = recurrenceEndDate;

    const meeting = await Meeting.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found.' });
    }

    return res.status(200).json({ success: true, data: meeting, message: 'Meeting updated.' });
  } catch (error) {
    console.error('Update meeting error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update meeting.' });
  }
};

export const remove = async (req, res) => {
  try {
    const meeting = await Meeting.findOneAndDelete({
      _id: req.params.id,
      organizationId: req.user.organizationId,
    });

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found.' });
    }

    return res.status(200).json({ success: true, message: 'Meeting deleted.' });
  } catch (error) {
    console.error('Delete meeting error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete meeting.' });
  }
};

export const cancel = async (req, res) => {
  try {
    const meeting = await Meeting.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      { status: 'cancelled' },
      { new: true }
    );

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found.' });
    }

    return res.status(200).json({ success: true, data: meeting, message: 'Meeting cancelled.' });
  } catch (error) {
    console.error('Cancel meeting error:', error);
    return res.status(500).json({ success: false, error: 'Failed to cancel meeting.' });
  }
};

export const addNotes = async (req, res) => {
  try {
    const { notes } = req.body;
    const meeting = await Meeting.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      { notes },
      { new: true }
    );

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found.' });
    }

    return res.status(200).json({ success: true, data: meeting, message: 'Notes updated.' });
  } catch (error) {
    console.error('Add notes error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update notes.' });
  }
};

export const generateNotesPdf = async (req, res) => {
  try {
    const meeting = await Meeting.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId,
    }).populate('projectId', 'name').populate('clientId', 'name');

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found.' });
    }

    const pdfBuffer = await generateMeetingNotesPdf(meeting.toObject());
    const { url } = await uploadFile(pdfBuffer, `meeting-notes-${meeting._id}.pdf`, 'application/pdf', 'meeting-notes');

    meeting.notesPdfUrl = url;
    await meeting.save();

    return res.status(200).json({ success: true, data: { notesPdfUrl: url }, message: 'PDF generated.' });
  } catch (error) {
    console.error('Generate notes PDF error:', error);
    return res.status(500).json({ success: false, error: 'Failed to generate PDF.' });
  }
};

export const sendNotes = async (req, res) => {
  try {
    const meeting = await Meeting.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId,
    }).populate('projectId', 'name').populate('clientId', 'name email whatsappNumber');

    if (!meeting) {
      return res.status(404).json({ success: false, error: 'Meeting not found.' });
    }

    const org = await Organization.findById(meeting.organizationId);

    // Generate PDF if not exists
    if (!meeting.notesPdfUrl) {
      const pdfBuffer = await generateMeetingNotesPdf(meeting.toObject());
      const { url } = await uploadFile(pdfBuffer, `meeting-notes-${meeting._id}.pdf`, 'application/pdf', 'meeting-notes');
      meeting.notesPdfUrl = url;
      await meeting.save();
    }

    const results = await notifyAttendees(
      meeting.attendees,
      `Notes: ${meeting.title}`,
      '',
      0,
      meeting.notesPdfUrl,
      org?.name || 'Team'
    );

    return res.status(200).json({ success: true, data: results, message: 'Notes sent.' });
  } catch (error) {
    console.error('Send notes error:', error);
    return res.status(500).json({ success: false, error: 'Failed to send notes.' });
  }
};
