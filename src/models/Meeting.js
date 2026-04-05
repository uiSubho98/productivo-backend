import mongoose from 'mongoose';

const attendeeSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      default: '',
    },
    whatsapp: {
      type: String,
      default: null,
    },
    type: {
      type: String,
      enum: ['organizer', 'attendee', 'client'],
      default: 'attendee',
    },
  },
  { _id: false }
);

const meetingSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Meeting title is required'],
      trim: true,
      maxlength: 300,
    },
    description: {
      type: String,
      default: '',
    },
    meetingType: {
      type: String,
      enum: ['client', 'personal'],
      default: 'personal',
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
    },
    attendees: [attendeeSchema],
    scheduledAt: {
      type: Date,
      required: [true, 'Scheduled time is required'],
    },
    duration: {
      type: Number,
      default: 60,
      min: 15,
    },
    googleCalendarEventId: {
      type: String,
      default: null,
    },
    meetLink: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: '',
    },
    notesPdfUrl: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
      default: 'scheduled',
    },
    recurrence: {
      type: String,
      enum: ['none', 'daily', 'weekly_mon_fri', 'weekly'],
      default: 'none',
    },
    recurrenceDays: {
      type: [String],
      enum: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
      default: [],
    },
    recurrenceEndDate: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

meetingSchema.index({ organizationId: 1 });
meetingSchema.index({ scheduledAt: 1 });
meetingSchema.index({ status: 1 });

const Meeting = mongoose.model('Meeting', meetingSchema);

export default Meeting;
