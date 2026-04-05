import ActivityLog from '../models/ActivityLog.js';

/**
 * Middleware that logs every API request to the ActivityLog collection.
 * Fires after the response is sent (non-blocking).
 */
export default function activityLogger(req, res, next) {
  const start = Date.now();

  // Skip health checks and static assets
  if (req.path === '/api/v1/health' || req.path.startsWith('/api/v1/upload')) {
    return next();
  }

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    ActivityLog.create({
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      userId: req.user?._id || null,
      userEmail: req.user?.email || null,
      userRole: req.user?.role || null,
      organizationId: req.user?.organizationId || null,
      ip: req.ip || req.headers['x-forwarded-for'] || null,
      durationMs,
      type: 'api',
      success: res.statusCode < 400,
    }).catch(() => {}); // never throw from logging
  });

  next();
}
