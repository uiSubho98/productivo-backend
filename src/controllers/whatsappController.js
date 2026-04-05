import WaMessage from '../models/WaMessage.js';
import ConversationStatus from '../models/ConversationStatus.js';
import Client from '../models/Client.js';
import {
  sendMessage,
  sendDocument,
  sendTemplate,
  exchangeToken,
  markMessageRead,
  getDailyCount,
} from '../services/whatsappService.js';
import { isWhatsappEnabledForOrg } from '../services/whatsappFeatureService.js';
import env from '../config/env.js';

/**
 * Shared guard for all WhatsApp tab operations.
 * Returns 403 with a clear message if feature is locked or expired.
 */
async function guardWhatsappAccess(req, res) {
  const { enabled, reason } = await isWhatsappEnabledForOrg(req.user.organizationId);
  if (!enabled) {
    res.status(403).json({
      success: false,
      error: reason,
      code: 'WHATSAPP_FEATURE_LOCKED',
    });
    return false;
  }
  return true;
}

// Socket.io instance — set from server.js after startup
let _io = null;
export const setSocketIo = (io) => { _io = io; };

function emitToOrg(orgId, event, payload) {
  if (_io) _io.to(String(orgId)).emit(event, payload);
}

// ────────────────────────────────────────────────────────────
// WEBHOOK
// ────────────────────────────────────────────────────────────

/** GET /api/v1/whatsapp/webhook  — Meta verification handshake */
export const verifyWebhook = (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.waWebhookVerifyToken) {
    console.log('[WA Webhook] Verified ✓');
    return res.status(200).send(challenge);
  }
  console.warn('[WA Webhook] Verification failed — wrong token');
  return res.status(403).json({ error: 'Webhook verification failed' });
};

/** POST /api/v1/whatsapp/webhook  — Receive messages & status updates from Meta */
export const receiveWebhook = async (req, res) => {
  // Respond immediately — Meta expects < 20 s
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field !== 'messages') continue;
        const value = change.value;
        const waPhoneId = value.metadata?.phone_number_id;

        // ── Delivery / read status updates ──
        for (const statusUpdate of value.statuses || []) {
          const updated = await WaMessage.findOneAndUpdate(
            { waMessageId: statusUpdate.id },
            { status: statusUpdate.status, updatedAt: new Date() },
            { new: true }
          );
          if (updated && _io) {
            emitToOrg(updated.organizationId, 'message:status', {
              waMessageId: statusUpdate.id,
              status: statusUpdate.status,
            });
          }
        }

        // ── Incoming messages ──
        for (const msg of value.messages || []) {
          const from        = msg.from; // digits-only phone (E.164 without +)
          const waMessageId = msg.id;
          const timestamp   = new Date(parseInt(msg.timestamp, 10) * 1000);
          const senderName  = value.contacts?.[0]?.profile?.name || from;

          let type    = msg.type || 'unknown';
          const content = {};

          switch (type) {
            case 'text':
              content.text = msg.text?.body || '';
              break;
            case 'document':
              content.document = {
                id:       msg.document?.id || '',
                filename: msg.document?.filename || 'document',
                mimeType: msg.document?.mime_type || '',
                caption:  msg.document?.caption || '',
              };
              break;
            case 'image':
              content.image = {
                id:      msg.image?.id || '',
                caption: msg.image?.caption || '',
              };
              break;
            default:
              content.text = `[${type} message]`;
              type = 'unknown';
          }

          // Lookup client by whatsapp number (try with and without +)
          const client = await Client.findOne({
            $or: [
              { whatsappNumber: from },
              { whatsappNumber: `+${from}` },
            ],
          }).lean();

          const clientId      = client?._id || null;
          const organizationId = client?.organizationId || null;

          // Save message
          const waMsg = await WaMessage.create({
            waMessageId,
            organizationId,
            clientId,
            phone: from,
            senderName,
            direction: 'inbound',
            type,
            content,
            status: 'delivered',
            isRead: false,
            timestamp,
          });

          // Upsert conversation status
          const preview = content.text || `[${type}]`;
          await ConversationStatus.findOneAndUpdate(
            { phone: from, organizationId },
            {
              $inc: { unreadCount: 1 },
              $set: {
                clientId,
                organizationId,
                displayName: senderName,
                lastMessageAt: timestamp,
                lastMessagePreview: preview,
                lastMessageDirection: 'inbound',
              },
            },
            { upsert: true, new: true }
          );

          // Send read receipt back to WhatsApp
          markMessageRead(waMessageId).catch(() => {});

          // Real-time push
          emitToOrg(organizationId, 'message:new', {
            ...waMsg.toObject(),
            senderName,
          });

          console.log(`[WA Webhook] Inbound from ${from}: "${preview.substring(0, 50)}"`);
        }
      }
    }
  } catch (err) {
    console.error('[WA Webhook] Processing error:', err.message);
  }
};

// ────────────────────────────────────────────────────────────
// CONVERSATIONS
// ────────────────────────────────────────────────────────────

/** GET /api/v1/whatsapp/conversations */
export const getConversations = async (req, res) => {
  try {
    if (!(await guardWhatsappAccess(req, res))) return;
    const { organizationId } = req.user;
    const conversations = await ConversationStatus.find({ organizationId })
      .populate('clientId', 'name email whatsappNumber phoneNumber countryCode')
      .sort({ lastMessageAt: -1 })
      .lean();

    return res.json({ success: true, data: conversations });
  } catch (error) {
    console.error('getConversations error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch conversations.' });
  }
};

/** GET /api/v1/whatsapp/conversations/:phone/messages?page=1&limit=50 */
export const getMessages = async (req, res) => {
  try {
    if (!(await guardWhatsappAccess(req, res))) return;
    const { phone } = req.params;
    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(100, parseInt(req.query.limit || '50', 10));

    const messages = await WaMessage.find({ phone })
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return res.json({ success: true, data: messages.reverse() });
  } catch (error) {
    console.error('getMessages error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch messages.' });
  }
};

/** PATCH /api/v1/whatsapp/conversations/:phone/mark-read */
export const markConversationRead = async (req, res) => {
  try {
    if (!(await guardWhatsappAccess(req, res))) return;
    const { phone } = req.params;
    await WaMessage.updateMany(
      { phone, isRead: false, direction: 'inbound' },
      { $set: { isRead: true } }
    );
    await ConversationStatus.findOneAndUpdate(
      { phone, organizationId: req.user.organizationId },
      { $set: { unreadCount: 0, lastSeen: new Date() } }
    );
    return res.json({ success: true });
  } catch (error) {
    console.error('markConversationRead error:', error);
    return res.status(500).json({ success: false, error: 'Failed to mark as read.' });
  }
};

// ────────────────────────────────────────────────────────────
// SEND MESSAGES
// ────────────────────────────────────────────────────────────

/** POST /api/v1/whatsapp/conversations/:phone/send */
export const sendToPhone = async (req, res) => {
  try {
    if (!(await guardWhatsappAccess(req, res))) return;
    const { phone } = req.params;
    const { type = 'text', message, documentUrl, caption, filename, templateName, languageCode, components } = req.body;

    let result;
    const content = {};

    switch (type) {
      case 'text':
        if (!message) return res.status(400).json({ success: false, error: 'message is required for text type.' });
        result  = await sendMessage(phone, message);
        content.text = message;
        break;

      case 'document':
        if (!documentUrl) return res.status(400).json({ success: false, error: 'documentUrl is required.' });
        result  = await sendDocument(phone, documentUrl, caption || '', filename || 'document.pdf');
        content.document = { url: documentUrl, caption: caption || '', filename: filename || 'document.pdf' };
        break;

      case 'template':
        if (!templateName) return res.status(400).json({ success: false, error: 'templateName is required.' });
        result  = await sendTemplate(phone, templateName, languageCode || 'en_US', components || []);
        content.template = { name: templateName, language: languageCode || 'en_US' };
        break;

      default:
        return res.status(400).json({ success: false, error: `Unsupported message type: ${type}` });
    }

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    // Resolve client
    const client = await Client.findOne({
      $or: [{ whatsappNumber: phone }, { whatsappNumber: `+${phone}` }],
    }).lean();

    const waMessageId = result.data?.messages?.[0]?.id || null;

    const waMsg = await WaMessage.create({
      waMessageId,
      organizationId: req.user.organizationId,
      clientId: client?._id || null,
      phone,
      senderName: 'You',
      direction: 'outbound',
      type,
      content,
      status: 'sent',
      isRead: true,
      timestamp: new Date(),
    });

    const preview = content.text || `[${type}]`;
    await ConversationStatus.findOneAndUpdate(
      { phone, organizationId: req.user.organizationId },
      {
        $set: {
          clientId: client?._id || null,
          organizationId: req.user.organizationId,
          displayName: client?.name || phone,
          lastMessageAt: new Date(),
          lastMessagePreview: preview,
          lastMessageDirection: 'outbound',
        },
      },
      { upsert: true }
    );

    emitToOrg(req.user.organizationId, 'message:new', waMsg.toObject());

    return res.status(201).json({ success: true, data: waMsg });
  } catch (error) {
    console.error('sendToPhone error:', error);
    return res.status(500).json({ success: false, error: 'Failed to send message.' });
  }
};

// ────────────────────────────────────────────────────────────
// TOKEN MANAGEMENT
// ────────────────────────────────────────────────────────────

/** POST /api/v1/whatsapp/token/exchange  — exchange short-lived for long-lived token */
export const exchangeAccessToken = async (req, res) => {
  try {
    const { shortLivedToken } = req.body;
    if (!shortLivedToken) {
      return res.status(400).json({ success: false, error: 'shortLivedToken is required.' });
    }
    const result = await exchangeToken(shortLivedToken);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    return res.json({ success: true, data: result.data });
  } catch (error) {
    console.error('exchangeAccessToken error:', error);
    return res.status(500).json({ success: false, error: 'Token exchange failed.' });
  }
};

/** GET /api/v1/whatsapp/stats — daily rate-limit status */
export const getStats = async (req, res) => {
  try {
    if (!(await guardWhatsappAccess(req, res))) return;
    const daily = getDailyCount();
    return res.json({ success: true, data: daily });
  } catch (error) {
    return res.status(500).json({ success: false, error: 'Failed to get stats.' });
  }
};
