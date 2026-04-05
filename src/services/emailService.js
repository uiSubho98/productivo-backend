import nodemailer from 'nodemailer';
import env from '../config/env.js';
import ActivityLog from '../models/ActivityLog.js';

const transporter = nodemailer.createTransport({
  host: env.smtpHost,
  port: env.smtpPort,
  secure: false,
  auth: {
    user: env.smtpUser,
    pass: env.smtpPass,
  },
  tls: {
    rejectUnauthorized: false,
  },
});

/**
 * Send an email via SMTP.
 * @param {string} to - recipient email
 * @param {string} subject
 * @param {string} htmlContent - HTML body
 * @param {Array} attachments - optional [{filename, content (Buffer), contentType}]
 * @param {string[]} cc - optional CC email addresses
 */
export const sendEmail = async (to, subject, htmlContent, attachments = [], cc = []) => {
  try {
    const mailOptions = {
      from: `"${env.smtpFromName}" <${env.smtpFromEmail}>`,
      to,
      subject,
      html: htmlContent,
    };

    if (cc.length > 0) {
      mailOptions.cc = cc.join(', ');
    }

    if (attachments.length > 0) {
      mailOptions.attachments = attachments.map((att) => ({
        filename: att.filename || att.name,
        content: att.content,
        contentType: att.contentType || 'application/pdf',
      }));
    }

    const result = await transporter.sendMail(mailOptions);
    console.log(`Email sent to ${to}${cc.length ? ` (cc: ${cc.join(', ')})` : ''}: ${result.messageId}`);
    ActivityLog.create({ type: 'email', to, subject, success: true }).catch(() => {});
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error(`Email send error to ${to}: ${error.message}`);
    ActivityLog.create({ type: 'email', to, subject, success: false, errorMsg: error.message }).catch(() => {});
    return { success: false, error: error.message };
  }
};

export default { sendEmail };
