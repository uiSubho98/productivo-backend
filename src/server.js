import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import env from './config/env.js';
import connectDB from './config/db.js';
import startScheduler from './jobs/scheduler.js';

import activityLogger from './middleware/activityLogger.js';
import superAdminRoutes from './routes/superAdmin.js';
import authRoutes from './routes/auth.js';
import organizationRoutes from './routes/organizations.js';
import clientRoutes from './routes/clients.js';
import projectRoutes from './routes/projects.js';
import taskRoutes from './routes/tasks.js';
import categoryRoutes from './routes/categories.js';
import invoiceRoutes from './routes/invoices.js';
import meetingRoutes from './routes/meetings.js';
import uploadRoutes from './routes/upload.js';
import userRoutes from './routes/users.js';
import paymentAccountRoutes from './routes/paymentAccounts.js';
import dashboardRoutes from './routes/dashboard.js';
import imageProxyRoutes from './routes/imageProxy.js';
import whatsappRoutes from './routes/whatsapp.js';
import locationRoutes from './routes/location.js';
import enquiryRoutes from './routes/enquiries.js';
import paymentRoutes from './routes/payments.js';
import subscriptionRoutes from './routes/subscription.js';
import featureFlagRoutes from './routes/featureFlags.js';
import whatsappAddonRoutes from './routes/whatsappAddons.js';
import usageRoutes from './routes/usage.js';
import invoicesPublicRoutes from './routes/invoicesPublic.js';
import attendanceRoutes from './routes/attendance.js';
import { setSocketIo } from './controllers/whatsappController.js';

const app = express();
const httpServer = createServer(app);

// Socket.io — rooms are keyed by organizationId so broadcasts are org-scoped
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

io.on('connection', (socket) => {
  const orgId = socket.handshake.query?.orgId;
  if (orgId) {
    socket.join(orgId);
    console.log(`[Socket.io] Client connected to org room: ${orgId}`);
  }
  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

setSocketIo(io);

// Static landing page — disable HTML caching so updates roll out instantly
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
app.use(express.static(join(__dirname, '../public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store, must-revalidate');
    }
  },
}));

// Security & parsing middleware
app.use(helmet({
  contentSecurityPolicy: false, // allow inline styles in landing page
}));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
}));
app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));
app.use(express.json({
  limit: '10mb',
  // Preserve the raw body so we can verify Cashfree webhook signatures
  verify: (req, _res, buf) => {
    if (buf && buf.length) req.rawBody = buf.toString('utf8');
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(activityLogger);

// Health check
app.get('/api/v1/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/organizations', organizationRoutes);
app.use('/api/v1/clients', clientRoutes);
app.use('/api/v1/projects', projectRoutes);
app.use('/api/v1/tasks', taskRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/invoices', invoiceRoutes);
app.use('/api/v1/meetings', meetingRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/payment-accounts', paymentAccountRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/image-proxy', imageProxyRoutes);
app.use('/api/v1/whatsapp', whatsappRoutes);
app.use('/api/v1/superadmin', superAdminRoutes);
app.use('/api/v1/location', locationRoutes);
app.use('/api/v1/enquiries', enquiryRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/subscription', subscriptionRoutes);
app.use('/api/v1/feature-flags', featureFlagRoutes);
app.use('/api/v1/whatsapp-addons', whatsappAddonRoutes);
app.use('/api/v1/usage', usageRoutes);
app.use('/api/v1/public/invoices', invoicesPublicRoutes); // public PDF proxy for WhatsApp document templates
app.use('/api/v1/attendance', attendanceRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.originalUrl} not found.`,
  });
});

// Global error handler
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    success: false,
    error: env.nodeEnv === 'production' ? 'Internal server error.' : err.message,
  });
});

// Bootstrap
const start = async () => {
  try {
    await connectDB();
    startScheduler();

    httpServer.listen(env.port, () => {
      console.log(`Server running on port ${env.port} [${env.nodeEnv}]`);
      console.log(`Socket.io ready`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

start();

export default app;
