import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import Subscription from '../models/Subscription.js';
import Client from '../models/Client.js';
import Project from '../models/Project.js';
import Task from '../models/Task.js';
import Invoice from '../models/Invoice.js';
import Meeting from '../models/Meeting.js';
import ActivityLog from '../models/ActivityLog.js';
import Category from '../models/Category.js';
import WhatsappFeature from '../models/WhatsappFeature.js';
import Purchase from '../models/Purchase.js';
import { generateToken } from '../middleware/auth.js';
import { sendEmail } from '../services/emailService.js';

/**
 * Step 1 of email-only signup: send a 6-digit OTP to the given email.
 * POST /api/v1/auth/signup/request-otp
 * Body: { email }
 */
export const signupRequestOtp = async (req, res) => {
  try {
    const email = req.body.email?.toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists.' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
    const salt = await bcrypt.genSalt(10);
    const otpHash = await bcrypt.hash(otp, salt);
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    // Store OTP temporarily on a pending user record (no passwordHash yet)
    await User.findOneAndUpdate(
      { email },
      {
        email,
        name: email.split('@')[0], // placeholder, updated after org setup
        passwordHash: await bcrypt.hash(Math.random().toString(36), 10), // throwaway
        role: 'superadmin',
        resetOtp: otpHash,
        resetOtpExpiry: expiry,
        isActive: false, // not active until OTP verified
      },
      { upsert: true, new: true }
    );

    const html = `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px;">
        <div style="text-align:center;margin-bottom:32px;">
          <div style="width:52px;height:52px;background:#2563eb;border-radius:14px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:16px;">
            <span style="color:#fff;font-size:26px;">⚡</span>
          </div>
          <h1 style="color:#111827;font-size:22px;font-weight:700;margin:0;">Verify your email</h1>
          <p style="color:#6b7280;font-size:14px;margin-top:8px;">Enter this OTP to create your free Productivo account.</p>
        </div>
        <div style="background:#f3f4f6;border-radius:16px;padding:32px;text-align:center;margin-bottom:24px;">
          <p style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 12px;">Your OTP</p>
          <p style="font-size:40px;font-weight:800;letter-spacing:12px;color:#1d4ed8;margin:0;">${otp}</p>
          <p style="color:#9ca3af;font-size:12px;margin-top:12px;">Expires in 10 minutes</p>
        </div>
        <p style="color:#9ca3af;font-size:12px;text-align:center;">If you didn't request this, you can safely ignore this email.</p>
      </div>`;

    await sendEmail(email, 'Your Productivo Sign-up OTP', html);

    return res.status(200).json({ success: true, message: 'OTP sent to your email.' });
  } catch (error) {
    console.error('signupRequestOtp error:', error);
    return res.status(500).json({ success: false, error: 'Failed to send OTP.' });
  }
};

/**
 * Step 2 of email-only signup: verify OTP → activate user + issue JWT.
 * POST /api/v1/auth/signup/verify-otp
 * Body: { email, otp }
 */
export const signupVerifyOtp = async (req, res) => {
  try {
    const email = req.body.email?.toLowerCase().trim();
    const { otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, error: 'Email and OTP are required.' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.resetOtp || !user.resetOtpExpiry) {
      return res.status(400).json({ success: false, error: 'OTP not found. Please request a new one.' });
    }

    if (new Date() > user.resetOtpExpiry) {
      user.resetOtp = null;
      user.resetOtpExpiry = null;
      await user.save();
      return res.status(400).json({ success: false, error: 'OTP has expired. Please request a new one.' });
    }

    const isMatch = await bcrypt.compare(otp, user.resetOtp);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Invalid OTP. Please try again.' });
    }

    // Activate user, clear OTP fields
    user.isActive = true;
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    await user.save();

    // Create free subscription if not already present
    let sub = await Subscription.findOne({ userId: user._id });
    if (!sub) sub = await Subscription.create({ userId: user._id, plan: 'free' });

    const token = generateToken(user._id);

    return res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
        },
        subscription: {
          plan: sub.plan,
          status: sub.isActive() ? 'active' : 'expired',
          expiresAt: sub.expiresAt,
        },
      },
      message: 'Email verified. Welcome to Productivo!',
    });
  } catch (error) {
    console.error('signupVerifyOtp error:', error);
    return res.status(500).json({ success: false, error: 'Verification failed.' });
  }
};

/**
 * Public signup — creates a free superadmin user + their master organisation + free subscription.
 * POST /api/v1/auth/register
 * Body: { name, email, password, orgName }
 */
export const register = async (req, res) => {
  try {
    const { name, email, password, orgName } = req.body;

    if (!name || !email || !password || !orgName) {
      return res.status(400).json({ success: false, error: 'Name, email, password and organisation name are required.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return res.status(400).json({ success: false, error: 'An account with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user first (role will be updated to superadmin after org is created)
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: 'superadmin',
    });

    // Create master organisation owned by this user
    const org = await Organization.create({
      name: orgName.trim(),
      adminIds: [user._id],
      superadminId: user._id,
      parentOrgId: null,
    });

    // Attach org to user
    user.organizationId = org._id;
    await user.save();

    // Create free subscription
    await Subscription.create({ userId: user._id, plan: 'free' });

    // Send welcome email (non-blocking)
    sendEmail(
      user.email,
      'Welcome to Productivo — Your Free Workspace is Ready',
      buildWelcomeEmail(user.name, org.name)
    ).catch(() => {});

    const token = generateToken(user._id);

    return res.status(201).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: org._id,
        },
        subscription: { plan: 'free', status: 'active', expiresAt: null },
      },
      message: 'Account created. Welcome to Productivo!',
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
};

function buildWelcomeEmail(name, orgName) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<style>
  body{margin:0;padding:0;background:#f4f4f7;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;}
  .wrapper{max-width:560px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);}
  .header{background:linear-gradient(135deg,#6366F1,#7C3AED);padding:40px;text-align:center;}
  .header h1{margin:0;color:#fff;font-size:26px;font-weight:800;}
  .header p{margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;}
  .body{padding:36px 40px;}
  .plan-box{background:#f5f3ff;border:1px solid #ede9fe;border-radius:10px;padding:20px 24px;margin:24px 0;}
  .plan-box h3{margin:0 0 12px;color:#4f46e5;font-size:15px;}
  .plan-box ul{margin:0;padding-left:18px;color:#374151;font-size:14px;line-height:1.8;}
  .cta{text-align:center;margin:28px 0;}
  .cta a{display:inline-block;background:linear-gradient(135deg,#6366F1,#7C3AED);color:#fff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:15px;font-weight:700;}
  .footer{background:#f9fafb;padding:24px 40px;text-align:center;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;}
</style>
</head>
<body>
<div class="wrapper">
  <div class="header">
    <h1>Welcome to Productivo</h1>
    <p>Your free workspace "${orgName}" is ready.</p>
  </div>
  <div class="body">
    <p style="font-size:16px;color:#1f2937;">Hi ${name},</p>
    <p style="font-size:14px;color:#374151;line-height:1.6;">You're all set! Your free Starter workspace has been created. Here's what you get:</p>
    <div class="plan-box">
      <h3>✦ Starter Plan (Free)</h3>
      <ul>
        <li>Up to <strong>3 clients</strong></li>
        <li>Up to <strong>5 active projects</strong></li>
        <li>Up to <strong>3 invoices/month</strong></li>
        <li><strong>Unlimited</strong> task management</li>
        <li>Up to <strong>10 team members</strong></li>
      </ul>
    </div>
    <p style="font-size:14px;color:#374151;line-height:1.6;">Ready to scale up? Upgrade to <strong>Pro for just ₹1499/year</strong> and unlock everything — unlimited clients, projects, invoices, and more.</p>
    <div class="cta">
      <a href="https://crm.productivo.in">Open Your Dashboard →</a>
    </div>
  </div>
  <div class="footer">© 2026 Productivo · <a href="https://www.productivo.in" style="color:#6366F1;">productivo.in</a></div>
</div>
</body>
</html>`;
}

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, error: 'Account is deactivated.' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const token = generateToken(user._id);

    // Attach subscription info for superadmins
    let subscriptionData = null;
    if (user.role === 'superadmin') {
      let sub = await Subscription.findOne({ userId: user._id });
      if (!sub) sub = await Subscription.create({ userId: user._id, plan: 'free' });
      subscriptionData = {
        plan: sub.plan,
        status: sub.isActive() ? 'active' : 'expired',
        expiresAt: sub.expiresAt,
      };
    }

    return res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
        },
        subscription: subscriptionData,
      },
      message: 'Login successful.',
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, error: 'Login failed.' });
  }
};

export const setupBiometric = async (req, res) => {
  try {
    const { biometricEnabled } = req.body;

    await User.findByIdAndUpdate(req.user._id, { biometricEnabled });

    return res.status(200).json({
      success: true,
      message: `Biometric ${biometricEnabled ? 'enabled' : 'disabled'} successfully.`,
    });
  } catch (error) {
    console.error('Setup biometric error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update biometric settings.',
    });
  }
};

export const setupMpin = async (req, res) => {
  try {
    const { mpin } = req.body;

    const salt = await bcrypt.genSalt(12);
    const mpinHash = await bcrypt.hash(mpin, salt);

    await User.findByIdAndUpdate(req.user._id, {
      mpinHash,
      mpinEnabled: true,
    });

    return res.status(200).json({
      success: true,
      message: 'MPIN setup successful.',
    });
  } catch (error) {
    console.error('Setup MPIN error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to setup MPIN.',
    });
  }
};

export const verifyMpin = async (req, res) => {
  try {
    const { mpin } = req.body;

    const user = await User.findById(req.user._id);

    if (!user.mpinEnabled || !user.mpinHash) {
      return res.status(400).json({
        success: false,
        error: 'MPIN is not set up.',
      });
    }

    const isMatch = await bcrypt.compare(mpin, user.mpinHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid MPIN.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'MPIN verified.',
    });
  } catch (error) {
    console.error('Verify MPIN error:', error);
    return res.status(500).json({
      success: false,
      error: 'MPIN verification failed.',
    });
  }
};

export const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-passwordHash -mpinHash');

    // Populate org only if it exists
    if (user.organizationId) {
      try {
        await user.populate('organizationId', 'name logo');
      } catch {
        // Org might have been deleted — clear stale ref
        user.organizationId = null;
        await user.save();
      }
    }

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Get profile error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch profile.',
    });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      return res.status(404).json({ success: false, error: 'No account found with that email address.' });
    }

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const salt = await bcrypt.genSalt(10);
    const otpHash = await bcrypt.hash(otp, salt);

    user.resetOtp = otpHash;
    user.resetOtpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await user.save();

    const html = `
      <div style="font-family: Inter, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="width: 48px; height: 48px; background: #2563eb; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
            <span style="color: white; font-size: 24px;">⚡</span>
          </div>
          <h1 style="color: #111827; font-size: 22px; font-weight: 700; margin: 0;">Reset Your Password</h1>
          <p style="color: #6b7280; font-size: 14px; margin-top: 8px;">Use the 4-digit OTP below to reset your password. It expires in 10 minutes.</p>
        </div>
        <div style="background: #f3f4f6; border-radius: 16px; padding: 32px; text-align: center; margin-bottom: 24px;">
          <p style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 12px 0;">Your OTP</p>
          <p style="font-size: 40px; font-weight: 800; letter-spacing: 12px; color: #1d4ed8; margin: 0;">${otp}</p>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `;

    await sendEmail(user.email, 'Password Reset OTP — Productivo', html);

    return res.status(200).json({ success: true, message: 'OTP sent to your email.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ success: false, error: 'Failed to send OTP.' });
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user || !user.resetOtp || !user.resetOtpExpiry) {
      return res.status(400).json({ success: false, error: 'OTP not found. Please request a new one.' });
    }

    if (new Date() > user.resetOtpExpiry) {
      user.resetOtp = null;
      user.resetOtpExpiry = null;
      await user.save();
      return res.status(400).json({ success: false, error: 'OTP has expired. Please request a new one.' });
    }

    const isMatch = await bcrypt.compare(otp, user.resetOtp);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Invalid OTP. Please try again.' });
    }

    return res.status(200).json({ success: true, message: 'OTP verified.' });
  } catch (error) {
    console.error('Verify OTP error:', error);
    return res.status(500).json({ success: false, error: 'OTP verification failed.' });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user || !user.resetOtp || !user.resetOtpExpiry) {
      return res.status(400).json({ success: false, error: 'OTP not found. Please restart the process.' });
    }

    if (new Date() > user.resetOtpExpiry) {
      user.resetOtp = null;
      user.resetOtpExpiry = null;
      await user.save();
      return res.status(400).json({ success: false, error: 'OTP has expired. Please request a new one.' });
    }

    const isMatch = await bcrypt.compare(otp, user.resetOtp);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: 'Invalid OTP.' });
    }

    const salt = await bcrypt.genSalt(12);
    user.passwordHash = await bcrypt.hash(newPassword, salt);
    user.resetOtp = null;
    user.resetOtpExpiry = null;
    await user.save();

    return res.status(200).json({ success: true, message: 'Password reset successfully.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ success: false, error: 'Password reset failed.' });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { name, avatar } = req.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (avatar !== undefined) updateData.avatar = avatar;

    const user = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    }).select('-passwordHash -mpinHash');

    return res.status(200).json({
      success: true,
      data: user,
      message: 'Profile updated.',
    });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update profile.',
    });
  }
};

/**
 * DELETE /api/v1/auth/account
 * Superadmin self-deletes their own account and all associated data.
 * Deletes: all their orgs, users, clients, projects, tasks, invoices, meetings,
 *          activity logs, categories, subscription, whatsapp feature, purchases.
 */
export const deleteOwnAccount = async (req, res) => {
  try {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, error: 'Only superadmin accounts can self-delete.' });
    }

    const userId = req.user._id;
    const orgs = await Organization.find({ superadminId: userId }).select('_id').lean();
    const orgIds = orgs.map((o) => o._id);

    await Promise.all([
      User.deleteMany({ $or: [{ _id: userId }, { organizationId: { $in: orgIds } }] }),
      Organization.deleteMany({ superadminId: userId }),
      Client.deleteMany({ organizationId: { $in: orgIds } }),
      Project.deleteMany({ organizationId: { $in: orgIds } }),
      Task.deleteMany({ organizationId: { $in: orgIds } }),
      Invoice.deleteMany({ organizationId: { $in: orgIds } }),
      Meeting.deleteMany({ organizationId: { $in: orgIds } }),
      ActivityLog.deleteMany({ organizationId: { $in: orgIds } }),
      Category.deleteMany({ organizationId: { $in: orgIds } }),
      Subscription.deleteMany({ userId }),
      WhatsappFeature.deleteMany({ superadminId: userId }),
      Purchase.deleteMany({ userId }),
    ]);

    return res.status(200).json({
      success: true,
      message: 'Your account and all associated data have been permanently deleted.',
    });
  } catch (error) {
    console.error('deleteOwnAccount error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete account.' });
  }
};
