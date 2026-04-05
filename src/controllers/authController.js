import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { generateToken } from '../middleware/auth.js';
import { sendEmail } from '../services/emailService.js';

export const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Email already registered.',
      });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // First user ever = superadmin, rest default to employee
    const userCount = await User.countDocuments();
    const assignedRole = userCount === 0 ? 'superadmin' : 'employee';

    const user = await User.create({
      name,
      email,
      passwordHash,
      role: assignedRole,
    });

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
          organizationId: user.organizationId,
        },
      },
      message: 'Registration successful.',
    });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({
      success: false,
      error: 'Registration failed.',
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        error: 'Account is deactivated.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
    }

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
      },
      message: 'Login successful.',
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({
      success: false,
      error: 'Login failed.',
    });
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

    // Always return success to avoid email enumeration
    if (!user) {
      return res.status(200).json({ success: true, message: 'If that email exists, an OTP has been sent.' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
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
          <p style="color: #6b7280; font-size: 14px; margin-top: 8px;">Use the OTP below to reset your password. It expires in 10 minutes.</p>
        </div>
        <div style="background: #f3f4f6; border-radius: 16px; padding: 32px; text-align: center; margin-bottom: 24px;">
          <p style="color: #6b7280; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 12px 0;">Your OTP</p>
          <p style="font-size: 40px; font-weight: 800; letter-spacing: 12px; color: #1d4ed8; margin: 0;">${otp}</p>
        </div>
        <p style="color: #9ca3af; font-size: 12px; text-align: center;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `;

    await sendEmail(user.email, 'Password Reset OTP — Productivo', html);

    return res.status(200).json({ success: true, message: 'If that email exists, an OTP has been sent.' });
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
