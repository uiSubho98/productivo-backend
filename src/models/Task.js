import mongoose from 'mongoose';

const subtaskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['todo', 'in_progress', 'done'],
      default: 'todo',
    },
    assignee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { _id: true }
);

const attachmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    url: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
    },
  },
  { _id: true }
);

const taskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: [true, 'Task title is required'],
      trim: true,
      maxlength: 300,
    },
    description: {
      type: String,
      default: '',
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Project',
      required: true,
    },
    categories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
      },
    ],
    assignees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    status: {
      type: String,
      enum: ['todo', 'in_progress', 'in_review', 'done'],
      default: 'todo',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    dueDate: {
      type: Date,
      default: null,
    },
    // Cached sum of all TaskTimeLog.durationMs for this task — updated on timer stop.
    totalTimeMs: {
      type: Number,
      default: 0,
    },
    // userId of whoever currently has a running timer on this task (null if idle).
    activeTimerBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    // When the current running timer was started — for live elapsed-time display on the frontend.
    activeTimerStartedAt: {
      type: Date,
      default: null,
    },
    attachments: [attachmentSchema],
    subtasks: [subtaskSchema],
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
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

taskSchema.index({ projectId: 1 });
taskSchema.index({ organizationId: 1 });
taskSchema.index({ status: 1 });
taskSchema.index({ assignees: 1 });
taskSchema.index({ categories: 1 });

const Task = mongoose.model('Task', taskSchema);

export default Task;
