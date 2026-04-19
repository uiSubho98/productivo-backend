import mongoose from 'mongoose';

/**
 * Each time a user starts/stops a task timer, one TaskTimeLog is written.
 * `endedAt` is null while the timer is running; stopping the timer fills it and
 * computes `durationMs`. The user can only have ONE running timer across any task
 * at a time (enforced in controller).
 */
const taskTimeLogSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    startedAt: { type: Date, required: true },
    endedAt: { type: Date, default: null },
    durationMs: { type: Number, default: 0 },
    note: { type: String, default: '', maxlength: 300 },
    // True when the midnight cron stopped this timer because the user forgot
    // to stop it (usually paired with a systemCheckout on AttendanceEntry).
    systemStopped: { type: Boolean, default: false },
  },
  { timestamps: true }
);

taskTimeLogSchema.index({ userId: 1, endedAt: 1 }); // fast lookup for the user's active timer
taskTimeLogSchema.index({ taskId: 1, startedAt: -1 });

export default mongoose.model('TaskTimeLog', taskTimeLogSchema);
