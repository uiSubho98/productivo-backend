import { google } from 'googleapis';
import { getGoogleAuthClient } from '../config/googleAuth.js';

/**
 * Create a Google Calendar event with a Google Meet link.
 * @param {string} title - event summary
 * @param {string} description - event description
 * @param {Date|string} startTime - ISO 8601 string
 * @param {Date|string} endTime - ISO 8601 string
 * @param {Array} attendees - [{email}]
 * @returns {{ eventId: string, meetLink: string }}
 */
export const createEvent = async (title, description, startTime, endTime, attendees = []) => {
  try {
    const auth = getGoogleAuthClient();
    const calendar = google.calendar({ version: 'v3', auth });

    const event = {
      summary: title,
      description,
      start: {
        dateTime: new Date(startTime).toISOString(),
        timeZone: 'Asia/Kolkata',
      },
      end: {
        dateTime: new Date(endTime).toISOString(),
        timeZone: 'Asia/Kolkata',
      },
      attendees: attendees.map((a) => ({ email: a.email })),
      conferenceData: {
        createRequest: {
          requestId: `meet-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 30 },
          { method: 'popup', minutes: 10 },
        ],
      },
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: event,
      conferenceDataVersion: 1,
      sendUpdates: 'all',
    });

    const meetLink =
      response.data.conferenceData?.entryPoints?.find(
        (ep) => ep.entryPointType === 'video'
      )?.uri || null;

    return {
      eventId: response.data.id,
      meetLink,
    };
  } catch (error) {
    console.error(`Google Calendar error: ${error.message}`);
    throw new Error(`Failed to create calendar event: ${error.message}`);
  }
};

export default { createEvent };
