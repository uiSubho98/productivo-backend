import mongoose from 'mongoose';

// Free-form notes attached to a task. For recurring tasks, the `date` field
// (YYYY-MM-DD string in the creator's local day) preserves which occurrence
// the note belongs to even after the task status flips back and forth.
const taskNoteSchema = new mongoose.Schema(
  {
    taskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Task',
      required: true,
      index: true,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

taskNoteSchema.index({ taskId: 1, date: -1, createdAt: -1 });

const TaskNote = mongoose.model('TaskNote', taskNoteSchema);

export default TaskNote;
