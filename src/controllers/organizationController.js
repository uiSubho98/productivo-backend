import bcrypt from 'bcryptjs';
import Organization from '../models/Organization.js';
import User from '../models/User.js';

export const create = async (req, res) => {
  try {
    const { name, logo, cinNumber, taxPercentage, address, phone, website } = req.body;

    const organization = await Organization.create({
      name,
      logo,
      cinNumber,
      taxPercentage,
      address,
      phone,
      website,
      adminIds: [req.user._id],
    });

    // Superadmin stays superadmin, others become org_admin
    const newRole = req.user.role === 'superadmin' ? 'superadmin' : 'org_admin';
    await User.findByIdAndUpdate(req.user._id, {
      organizationId: organization._id,
      role: newRole,
    });

    return res.status(201).json({
      success: true,
      data: organization,
      message: 'Organization created.',
    });
  } catch (error) {
    console.error('Create organization error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create organization.',
    });
  }
};

export const getAll = async (req, res) => {
  try {
    // Return orgs the user belongs to
    const user = req.user;
    const filter = {};

    if (user.role === 'superadmin') {
      // superadmin sees all organizations
    } else if (user.organizationId) {
      filter._id = user.organizationId;
    } else {
      // Admin might see orgs they're admin of
      filter.adminIds = user._id;
    }

    const organizations = await Organization.find(filter).populate('adminIds', 'name email');

    const orgIds = organizations.map((o) => o._id);
    const memberCounts = await User.aggregate([
      { $match: { organizationId: { $in: orgIds }, role: { $ne: 'superadmin' } } },
      { $group: { _id: '$organizationId', count: { $sum: 1 } } },
    ]);
    const countMap = Object.fromEntries(memberCounts.map((m) => [m._id.toString(), m.count]));

    const data = organizations.map((org) => ({
      ...org.toObject(),
      memberCount: countMap[org._id.toString()] || 0,
    }));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Get organizations error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch organizations.',
    });
  }
};

export const getById = async (req, res) => {
  try {
    const organization = await Organization.findById(req.params.id).populate(
      'adminIds',
      'name email'
    );

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: organization,
    });
  } catch (error) {
    console.error('Get organization error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch organization.',
    });
  }
};

export const update = async (req, res) => {
  try {
    const { name, logo, cinNumber, taxPercentage, address, phone, website } = req.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (logo !== undefined) updateData.logo = logo;
    if (cinNumber !== undefined) updateData.cinNumber = cinNumber;
    if (taxPercentage !== undefined) updateData.taxPercentage = taxPercentage;
    if (address !== undefined) updateData.address = address;
    if (phone !== undefined) updateData.phone = phone;
    if (website !== undefined) updateData.website = website;

    const organization = await Organization.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!organization) {
      return res.status(404).json({
        success: false,
        error: 'Organization not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: organization,
      message: 'Organization updated.',
    });
  } catch (error) {
    console.error('Update organization error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update organization.',
    });
  }
};

export const getMembers = async (req, res) => {
  try {
    const members = await User.find({
      organizationId: req.params.id,
    }).select('-passwordHash -mpinHash');

    return res.status(200).json({
      success: true,
      data: members,
    });
  } catch (error) {
    console.error('Get members error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch members.',
    });
  }
};

export const addMember = async (req, res) => {
  try {
    const { email, name, password, role } = req.body;
    const { id: orgId } = req.params;
    const assignRole = role === 'org_admin' ? 'org_admin' : 'employee';

    // Rule: org must have at least 1 org_admin before employees can be added
    // (the requesting org_admin counts as one even if their organizationId was just set)
    if (assignRole === 'employee') {
      const requestingUserIsAdmin = req.user.role === 'org_admin' || req.user.role === 'superadmin';
      if (!requestingUserIsAdmin) {
        const orgAdminCount = await User.countDocuments({
          organizationId: orgId,
          role: 'org_admin',
        });
        if (orgAdminCount === 0) {
          return res.status(400).json({
            success: false,
            error: 'Organization must have at least 1 admin before adding employees. Add an admin first.',
          });
        }
      }
    }

    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (user.organizationId && user.organizationId.toString() !== orgId) {
        return res.status(400).json({
          success: false,
          error: 'User already belongs to another organization.',
        });
      }

      await User.findByIdAndUpdate(user._id, {
        organizationId: orgId,
        role: assignRole,
      });

      return res.status(200).json({
        success: true,
        message: `${user.name || user.email} added as ${assignRole}.`,
      });
    }

    // New user — create account
    if (!password) {
      return res.status(400).json({
        success: false,
        error: 'Password is required for new members.',
      });
    }

    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    user = await User.create({
      name: name || email.split('@')[0],
      email: email.toLowerCase(),
      passwordHash,
      role: assignRole,
      organizationId: orgId,
      isActive: true,
    });

    return res.status(201).json({
      success: true,
      message: `Account created for ${user.name} as ${assignRole}. They can login with their email and password.`,
    });
  } catch (error) {
    console.error('Add member error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add member.',
    });
  }
};

export const remove = async (req, res) => {
  try {
    const { id } = req.params;
    const requester = req.user;

    const org = await Organization.findById(id);
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found.' });
    }

    // Org admin can only delete their own org
    if (requester.role === 'org_admin' && requester.organizationId?.toString() !== id) {
      return res.status(403).json({ success: false, error: 'You can only delete your own organization.' });
    }

    await Organization.findByIdAndDelete(id);

    // Clear org membership for all users in this org (non-superadmin)
    await User.updateMany(
      { organizationId: id, role: { $ne: 'superadmin' } },
      { $set: { organizationId: null, role: 'employee' } }
    );

    return res.status(200).json({ success: true, message: 'Organization deleted.' });
  } catch (error) {
    console.error('Delete organization error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete organization.' });
  }
};

export const removeMember = async (req, res) => {
  try {
    const { id: orgId, userId } = req.params;
    const requester = req.user;

    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    // Can't remove yourself
    if (targetUser._id.toString() === requester._id.toString()) {
      return res.status(400).json({ success: false, error: 'You cannot remove yourself.' });
    }

    // Can't remove a superadmin
    if (targetUser.role === 'superadmin') {
      return res.status(403).json({ success: false, error: 'Cannot remove a superadmin.' });
    }

    // Superadmin can remove anyone from any org
    if (requester.role === 'superadmin') {
      await User.findByIdAndUpdate(userId, { organizationId: null, role: 'employee' });
      return res.status(200).json({ success: true, message: `${targetUser.name} removed from organization.` });
    }

    // Org admin can only remove members of their own org
    if (requester.role === 'org_admin') {
      if (!targetUser.organizationId || targetUser.organizationId.toString() !== orgId) {
        return res.status(403).json({ success: false, error: 'User does not belong to this organization.' });
      }

      // Org admin can't remove other org admins — only superadmin can
      if (targetUser.role === 'org_admin') {
        return res.status(403).json({ success: false, error: 'Only superadmin can remove org admins.' });
      }

      await User.findByIdAndUpdate(userId, { organizationId: null });
      return res.status(200).json({ success: true, message: `${targetUser.name} removed from organization.` });
    }

    return res.status(403).json({ success: false, error: 'Insufficient permissions.' });
  } catch (error) {
    console.error('Remove member error:', error);
    return res.status(500).json({ success: false, error: 'Failed to remove member.' });
  }
};
