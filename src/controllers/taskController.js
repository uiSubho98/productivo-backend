import Task from '../models/Task.js';
import { uploadFile } from '../services/storageService.js';

export const create = async (req, res) => {
  try {
    const {
      title,
      description,
      projectId,
      categories,
      assignees,
      status,
      priority,
      dueDate,
      subtasks,
      recurrence,
      recurrenceDays,
      recurrenceEndDate,
    } = req.body;

    // Superadmin may not have an organizationId, so they pass it in the body
    const orgId = req.user.organizationId || (req.user.role === 'superadmin' ? req.body.organizationId : null);

    const task = await Task.create({
      title,
      description,
      projectId,
      categories: Array.isArray(categories) ? categories : (categories ? [categories] : []),
      assignees: assignees || [],
      status: status || 'todo',
      priority: priority || 'medium',
      dueDate: dueDate || null,
      subtasks: subtasks || [],
      organizationId: orgId,
      recurrence: recurrence || 'none',
      recurrenceDays: recurrenceDays || [],
      recurrenceEndDate: recurrenceEndDate || null,
    });

    const populatedTask = await Task.findById(task._id)
      .populate('assignees', 'name email')
      .populate('categories', 'name')
      .populate('projectId', 'name');

    return res.status(201).json({
      success: true,
      data: populatedTask,
      message: 'Task created.',
    });
  } catch (error) {
    console.error('Create task error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create task.',
    });
  }
};

export const getAll = async (req, res) => {
  try {
    const { projectId, status, assignee, categoryId, priority } = req.query;
    const filter = { organizationId: req.user.organizationId };

    // Employees only see tasks assigned to them
    if (req.user.role === 'employee') {
      filter.assignees = req.user._id;
    }

    if (projectId) filter.projectId = projectId;
    if (status) filter.status = status;
    if (assignee) filter.assignees = assignee;
    if (categoryId) filter.categories = categoryId;
    if (priority) filter.priority = priority;

    const tasks = await Task.find(filter)
      .populate('assignees', 'name email avatar')
      .populate('categories', 'name')
      .populate('projectId', 'name')
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      data: tasks,
    });
  } catch (error) {
    console.error('Get tasks error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch tasks.',
    });
  }
};

export const getById = async (req, res) => {
  try {
    const task = await Task.findOne({
      _id: req.params.id,
      organizationId: req.user.organizationId,
    })
      .populate('assignees', 'name email avatar')
      .populate('categories', 'name')
      .populate('projectId', 'name')
      .populate('subtasks.assignee', 'name email');

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: task,
    });
  } catch (error) {
    console.error('Get task error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch task.',
    });
  }
};

export const update = async (req, res) => {
  try {
    const {
      title,
      description,
      categories,
      assignees,
      status,
      priority,
      dueDate,
      recurrence,
      recurrenceDays,
      recurrenceEndDate,
    } = req.body;
    const updateData = {};

    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (categories !== undefined) updateData.categories = Array.isArray(categories) ? categories : (categories ? [categories] : []);
    if (assignees !== undefined) updateData.assignees = assignees;
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (recurrence !== undefined) updateData.recurrence = recurrence;
    if (recurrenceDays !== undefined) updateData.recurrenceDays = recurrenceDays;
    if (recurrenceEndDate !== undefined) updateData.recurrenceEndDate = recurrenceEndDate;

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      updateData,
      { new: true, runValidators: true }
    )
      .populate('assignees', 'name email')
      .populate('categories', 'name')
      .populate('projectId', 'name');

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: task,
      message: 'Task updated.',
    });
  } catch (error) {
    console.error('Update task error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update task.',
    });
  }
};

export const remove = async (req, res) => {
  try {
    const task = await Task.findOneAndDelete({
      _id: req.params.id,
      organizationId: req.user.organizationId,
    });

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Task deleted.',
    });
  } catch (error) {
    console.error('Delete task error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete task.',
    });
  }
};

export const addSubtask = async (req, res) => {
  try {
    const { title, assignee } = req.body;

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      {
        $push: {
          subtasks: {
            title,
            status: 'todo',
            assignee: assignee || null,
          },
        },
      },
      { new: true, runValidators: true }
    ).populate('subtasks.assignee', 'name email');

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: task.subtasks,
      message: 'Subtask added.',
    });
  } catch (error) {
    console.error('Add subtask error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add subtask.',
    });
  }
};

export const updateSubtask = async (req, res) => {
  try {
    const { subtaskId } = req.params;
    const { title, status, assignee } = req.body;
    const updateFields = {};

    if (title !== undefined) updateFields['subtasks.$.title'] = title;
    if (status !== undefined) updateFields['subtasks.$.status'] = status;
    if (assignee !== undefined) updateFields['subtasks.$.assignee'] = assignee;

    const task = await Task.findOneAndUpdate(
      {
        _id: req.params.id,
        organizationId: req.user.organizationId,
        'subtasks._id': subtaskId,
      },
      { $set: updateFields },
      { new: true, runValidators: true }
    ).populate('subtasks.assignee', 'name email');

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task or subtask not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: task.subtasks,
      message: 'Subtask updated.',
    });
  } catch (error) {
    console.error('Update subtask error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update subtask.',
    });
  }
};

export const addAttachment = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded.',
      });
    }

    const { url } = await uploadFile(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      `tasks/${req.params.id}`
    );

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      {
        $push: {
          attachments: {
            name: req.file.originalname,
            url,
            type: req.file.mimetype,
          },
        },
      },
      { new: true }
    );

    if (!task) {
      return res.status(404).json({
        success: false,
        error: 'Task not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: task.attachments,
      message: 'Attachment added.',
    });
  } catch (error) {
    console.error('Add attachment error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add attachment.',
    });
  }
};
