import User from '../models/User.js';

export const getAll = async (req, res) => {
  try {
    const { search, role, organizationId, page = 1, limit = 20 } = req.query;
    const filter = {};

    if (role) filter.role = role;
    if (organizationId) filter.organizationId = organizationId;

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await User.countDocuments(filter);

    const users = await User.find(filter)
      .select('-passwordHash -mpinHash')
      .populate('organizationId', 'name logo')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    return res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(total / parseInt(limit)),
        },
      },
    });
  } catch (error) {
    console.error('Get users error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch users.' });
  }
};

export const getById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-passwordHash -mpinHash')
      .populate('organizationId', 'name logo');

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    return res.status(200).json({ success: true, data: user });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch user.' });
  }
};

export const updateUser = async (req, res) => {
  try {
    const { name, role, isActive } = req.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (role !== undefined && ['org_admin', 'employee'].includes(role)) updateData.role = role;
    if (isActive !== undefined) updateData.isActive = isActive;

    const user = await User.findByIdAndUpdate(req.params.id, updateData, { new: true })
      .select('-passwordHash -mpinHash')
      .populate('organizationId', 'name logo');

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    return res.status(200).json({ success: true, data: user, message: 'User updated.' });
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update user.' });
  }
};

export const deleteUser = async (req, res) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) {
      return res.status(404).json({ success: false, error: 'User not found.' });
    }

    if (target.role === 'superadmin') {
      return res.status(403).json({ success: false, error: 'Cannot delete superadmin.' });
    }

    if (target._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ success: false, error: 'Cannot delete yourself.' });
    }

    await User.findByIdAndDelete(req.params.id);

    return res.status(200).json({ success: true, message: `${target.name} deleted.` });
  } catch (error) {
    console.error('Delete user error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete user.' });
  }
};
