import Project from '../models/Project.js';
import Task from '../models/Task.js';
import Client from '../models/Client.js';
import User from '../models/User.js';
import { getSuperadminOrgIds } from '../middleware/auth.js';

// Weighted progress: done=1.0, in_review=0.66, in_progress=0.33, todo/backlog=0
const STATUS_WEIGHT = { done: 1, completed: 1, in_review: 0.66, in_progress: 0.33, todo: 0, backlog: 0 };

async function attachTaskStats(projects) {
  const ids = projects.map((p) => p._id);
  const tasks = await Task.find({ projectId: { $in: ids } }, 'projectId status').lean();
  const map = {};
  for (const t of tasks) {
    const key = String(t.projectId);
    if (!map[key]) map[key] = { total: 0, done: 0, inProgress: 0, inReview: 0, todo: 0, weightSum: 0 };
    map[key].total++;
    map[key].weightSum += STATUS_WEIGHT[t.status] ?? 0;
    if (['done', 'completed'].includes(t.status)) map[key].done++;
    else if (t.status === 'in_review') map[key].inReview++;
    else if (t.status === 'in_progress') map[key].inProgress++;
    else map[key].todo++;
  }
  return projects.map((p) => {
    const s = map[String(p._id)] || { total: 0, done: 0, inProgress: 0, inReview: 0, todo: 0, weightSum: 0 };
    const obj = typeof p.toObject === 'function' ? p.toObject() : { ...p };
    obj.totalTasks = s.total;
    obj.doneTasks = s.done;
    obj.inProgressTasks = s.inProgress;
    obj.inReviewTasks = s.inReview;
    obj.todoTasks = s.todo;
    obj.progress = s.total > 0 ? Math.round((s.weightSum / s.total) * 100) : 0;
    return obj;
  });
}

export const create = async (req, res) => {
  try {
    const { name, description, clientId, status, startDate, endDate, domain, envFile } = req.body;

    const project = await Project.create({
      name,
      description,
      clientId: clientId || null,
      organizationId: req.user.organizationId,
      status: status || 'active',
      startDate: startDate || null,
      endDate: endDate || null,
      domain: domain || null,
      envFile: envFile || null,
    });

    // If clientId provided, auto-add the client as a member
    if (clientId) {
      const client = await Client.findById(clientId).lean();
      if (client) {
        project.members.push({
          clientId: client._id,
          name: client.name,
          email: client.email || '',
          phone: client.phoneNumber || '',
          whatsappNumber: client.whatsappNumber || '',
          countryCode: client.countryCode || '+91',
          role: 'client',
        });
        await project.save();
      }
    }

    return res.status(201).json({
      success: true,
      data: project,
      message: 'Project created.',
    });
  } catch (error) {
    console.error('Create project error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create project.',
    });
  }
};

export const getAll = async (req, res) => {
  try {
    if (req.user.role === 'product_owner') {
      return res.status(403).json({ success: false, error: 'Product owner cannot access project data.' });
    }
    const projectOrgIds = await getSuperadminOrgIds(req.user);
    if (!projectOrgIds || projectOrgIds.length === 0) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const { clientId, status } = req.query;
    const filter = { organizationId: { $in: projectOrgIds } };

    if (clientId) filter.clientId = clientId;
    if (status) filter.status = status;

    const projects = await Project.find(filter)
      .populate('clientId', 'name email')
      .sort({ createdAt: -1 });

    const data = await attachTaskStats(projects);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Get projects error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch projects.',
    });
  }
};

export const getById = async (req, res) => {
  try {
    if (req.user.role === 'product_owner') {
      return res.status(403).json({ success: false, error: 'Product owner cannot access project data.' });
    }
    const projectByIdOrgIds = await getSuperadminOrgIds(req.user);
    if (!projectByIdOrgIds || projectByIdOrgIds.length === 0) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const project = await Project.findOne({
      _id: req.params.id,
      organizationId: { $in: projectByIdOrgIds },
    }).populate('clientId', 'name email phoneNumber');

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found.',
      });
    }

    const [withStats] = await attachTaskStats([project]);

    return res.status(200).json({
      success: true,
      data: withStats,
    });
  } catch (error) {
    console.error('Get project error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch project.',
    });
  }
};

export const update = async (req, res) => {
  try {
    const { name, description, clientId, status, startDate, endDate, domain, envFile } = req.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (clientId !== undefined) updateData.clientId = clientId;
    if (status !== undefined) updateData.status = status;
    if (startDate !== undefined) updateData.startDate = startDate;
    if (endDate !== undefined) updateData.endDate = endDate;
    if (domain !== undefined) updateData.domain = domain;
    if (envFile !== undefined) updateData.envFile = envFile;

    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      updateData,
      { new: true, runValidators: true }
    );

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: project,
      message: 'Project updated.',
    });
  } catch (error) {
    console.error('Update project error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update project.',
    });
  }
};

export const remove = async (req, res) => {
  try {
    const project = await Project.findOneAndDelete({
      _id: req.params.id,
      organizationId: req.user.organizationId,
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Project deleted.',
    });
  } catch (error) {
    console.error('Delete project error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete project.',
    });
  }
};

export const getStats = async (req, res) => {
  try {
    const projectId = req.params.id;

    const project = await Project.findOne({
      _id: projectId,
      organizationId: req.user.organizationId,
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        error: 'Project not found.',
      });
    }

    const tasks = await Task.find({ projectId });

    const stats = {
      totalTasks: tasks.length,
      todo: tasks.filter((t) => t.status === 'todo').length,
      inProgress: tasks.filter((t) => t.status === 'in_progress').length,
      inReview: tasks.filter((t) => t.status === 'in_review').length,
      done: tasks.filter((t) => t.status === 'done').length,
      overdue: tasks.filter(
        (t) => t.dueDate && new Date(t.dueDate) < new Date() && t.status !== 'done'
      ).length,
      byPriority: {
        low: tasks.filter((t) => t.priority === 'low').length,
        medium: tasks.filter((t) => t.priority === 'medium').length,
        high: tasks.filter((t) => t.priority === 'high').length,
        urgent: tasks.filter((t) => t.priority === 'urgent').length,
      },
    };

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Get project stats error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch project stats.',
    });
  }
};

// ────────────────────────────────────────────────────────────────
// PROJECT MEMBER MANAGEMENT
// ────────────────────────────────────────────────────────────────

/** POST /api/v1/projects/:id/members
 *  Body: { name, email, phone, whatsappNumber, countryCode, role, userId?, clientId? }
 *  Or shorthand: { userId } to add an org user, { clientId } to add a client
 */
export const addMember = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId,
    });
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });

    const { userId, clientId, name, email, phone, whatsappNumber, countryCode, role } = req.body;

    let memberData = { name, email: email || '', phone: phone || '', whatsappNumber: whatsappNumber || '', countryCode: countryCode || '+91', role: role || 'employee' };

    // Auto-fill from User record
    if (userId) {
      const user = await User.findById(userId).lean();
      if (!user) return res.status(404).json({ success: false, error: 'User not found.' });
      memberData = {
        userId: user._id,
        name: name || user.name,
        email: email || user.email || '',
        phone: phone || user.phone || '',
        whatsappNumber: whatsappNumber || user.whatsappNumber || '',
        countryCode: countryCode || user.countryCode || '+91',
        role: role || 'employee',
      };
    }

    // Auto-fill from Client record
    if (clientId) {
      const client = await Client.findById(clientId).lean();
      if (!client) return res.status(404).json({ success: false, error: 'Client not found.' });
      memberData = {
        clientId: client._id,
        name: name || client.name,
        email: email || client.email || '',
        phone: phone || client.phoneNumber || '',
        whatsappNumber: whatsappNumber || client.whatsappNumber || '',
        countryCode: countryCode || client.countryCode || '+91',
        role: 'client',
      };
    }

    if (!memberData.name) return res.status(400).json({ success: false, error: 'name is required.' });

    project.members.push(memberData);
    await project.save();

    return res.status(201).json({ success: true, data: project, message: 'Member added.' });
  } catch (error) {
    console.error('addMember error:', error);
    return res.status(500).json({ success: false, error: 'Failed to add member.' });
  }
};

/** DELETE /api/v1/projects/:id/members/:memberId */
export const removeMember = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId,
    });
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });

    const idx = project.members.findIndex((m) => m._id.toString() === req.params.memberId);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Member not found.' });

    project.members.splice(idx, 1);
    await project.save();

    return res.json({ success: true, data: project, message: 'Member removed.' });
  } catch (error) {
    console.error('removeMember error:', error);
    return res.status(500).json({ success: false, error: 'Failed to remove member.' });
  }
};

/** PUT /api/v1/projects/:id/members/:memberId — update member details */
export const updateMember = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId,
    });
    if (!project) return res.status(404).json({ success: false, error: 'Project not found.' });

    const member = project.members.id(req.params.memberId);
    if (!member) return res.status(404).json({ success: false, error: 'Member not found.' });

    const { name, email, phone, whatsappNumber, countryCode, role } = req.body;
    if (name !== undefined) member.name = name;
    if (email !== undefined) member.email = email;
    if (phone !== undefined) member.phone = phone;
    if (whatsappNumber !== undefined) member.whatsappNumber = whatsappNumber;
    if (countryCode !== undefined) member.countryCode = countryCode;
    if (role !== undefined) member.role = role;

    await project.save();
    return res.json({ success: true, data: project, message: 'Member updated.' });
  } catch (error) {
    console.error('updateMember error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update member.' });
  }
};
