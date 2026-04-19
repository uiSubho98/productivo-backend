import mongoose from 'mongoose';

/**
 * One row per user per calendar day (local date).
 * Current session tracked via `loginAt` (set on clock-in).
 * When the user clocks out, loginAt is appended to `sessions`, durationMs summed, loginAt cleared.
 * This supports multiple login/logouts per day (e.g. lunch break).
 */
const sessionSchema = new mongoose.Schema(
  {
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    durationMs: { type: Number, required: true, min: 0 },
    // True when the session was force-closed by the midnight cron
    // because the user forgot to clock out.
    systemCheckout: { type: Boolean, default: false },
  },
  { _id: false }
);

const attendanceEntrySchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
    // YYYY-MM-DD in the server's local timezone — unique per user per day
    date: { type: String, required: true },
    // Active session — set on clock-in, cleared on clock-out
    loginAt: { type: Date, default: null },
    // Completed sessions for this date
    sessions: { type: [sessionSchema], default: [] },
    // Sum of all completed session durations (milliseconds)
    totalDurationMs: { type: Number, default: 0 },
  },
  { timestamps: true }
);

attendanceEntrySchema.index({ userId: 1, date: 1 }, { unique: true });
attendanceEntrySchema.index({ organizationId: 1, date: -1 });

export default mongoose.model('AttendanceEntry', attendanceEntrySchema);
