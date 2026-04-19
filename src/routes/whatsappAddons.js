import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  getMyAddons,
  getAddonLogs,
  sendInvoiceViaWhatsapp,
  sendTaskReminderViaWhatsapp,
  sendMeetingInviteViaWhatsapp,
} from '../controllers/whatsappAddonController.js';

const router = Router();

router.use(authenticate);

router.get('/me', getMyAddons);
router.get('/logs', getAddonLogs);
router.post('/send-invoice/:invoiceId', sendInvoiceViaWhatsapp);
router.post('/send-task-reminder/:taskId', sendTaskReminderViaWhatsapp);
router.post('/send-meeting-invite/:meetingId', sendMeetingInviteViaWhatsapp);

export default router;
