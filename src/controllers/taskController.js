import Task from '../models/Task.js';
import TaskNote from '../models/TaskNote.js';
import { uploadFile } from '../services/storageService.js';
import { getSuperadminOrgIds } from '../middleware/auth.js';

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

    // product_owner cannot create tasks — they have no org scope
    if (req.user.role === 'product_owner') {
      return res.status(403).json({ success: false, error: 'Product owner cannot create tasks.' });
    }
    const orgId = req.user.organizationId;

    const task = await Task.create({
      title,
      description,
      projectId: projectId || null,
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

    // product_owner has no task data
    if (req.user.role === 'product_owner') {
      return res.status(403).json({ success: false, error: 'Product owner cannot access task data.' });
    }

    // Resolve org scope: superadmin sees all their orgs; others see only their own
    const orgIds = await getSuperadminOrgIds(req.user);
    if (!orgIds || orgIds.length === 0) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const filter = { organizationId: { $in: orgIds } };

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
    if (req.user.role === 'product_owner') {
      return res.status(403).json({ success: false, error: 'Product owner cannot access task data.' });
    }
    const orgIds = await getSuperadminOrgIds(req.user);
    if (!orgIds || orgIds.length === 0) {
      return res.status(403).json({ success: false, error: 'No organization access.' });
    }
    const task = await Task.findOne({
      _id: req.params.id,
      organizationId: { $in: orgIds },
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
    const { title, url, assignee } = req.body;

    const task = await Task.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      {
        $push: {
          subtasks: {
            title,
            url: (url || '').trim(),
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
    const { title, url, status, assignee } = req.body;
    const updateFields = {};

    if (title !== undefined) updateFields['subtasks.$.title'] = title;
    if (url !== undefined) updateFields['subtasks.$.url'] = url;
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

export const deleteSubtask = async (req, res) => {
  try {
    const { id, subtaskId } = req.params;

    const task = await Task.findOneAndUpdate(
      { _id: id, organizationId: req.user.organizationId },
      { $pull: { subtasks: { _id: subtaskId } } },
      { new: true }
    ).populate('subtasks.assignee', 'name email');

    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    return res.status(200).json({
      success: true,
      data: task.subtasks,
      message: 'Subtask deleted.',
    });
  } catch (error) {
    console.error('Delete subtask error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete subtask.' });
  }
};

// ── Notes ──────────────────────────────────────────────────────────

const todayYMD = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const addNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { content, date } = req.body;

    const task = await Task.findOne({
      _id: id,
      organizationId: req.user.organizationId,
    });
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    const note = await TaskNote.create({
      taskId: task._id,
      organizationId: task.organizationId,
      date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayYMD(),
      content: String(content || '').trim(),
      createdBy: req.user._id,
    });

    const populated = await TaskNote.findById(note._id).populate('createdBy', 'name email');

    return res.status(201).json({
      success: true,
      data: populated,
      message: 'Note added.',
    });
  } catch (error) {
    console.error('Add note error:', error);
    return res.status(500).json({ success: false, error: 'Failed to add note.' });
  }
};

export const listNotes = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, from, to } = req.query;

    const task = await Task.findOne({
      _id: id,
      organizationId: req.user.organizationId,
    }).select('_id');
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found.' });
    }

    const filter = { taskId: task._id };
    if (date) filter.date = date;
    else if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = to;
    }

    const notes = await TaskNote.find(filter)
      .populate('createdBy', 'name email')
      .sort({ date: -1, createdAt: -1 });

    return res.status(200).json({ success: true, data: notes });
  } catch (error) {
    console.error('List notes error:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch notes.' });
  }
};

export const updateNote = async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const { content, date } = req.body;
    const update = {};
    if (content !== undefined) update.content = String(content).trim();
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) update.date = date;

    const note = await TaskNote.findOneAndUpdate(
      { _id: noteId, taskId: id, organizationId: req.user.organizationId },
      update,
      { new: true }
    ).populate('createdBy', 'name email');

    if (!note) {
      return res.status(404).json({ success: false, error: 'Note not found.' });
    }

    return res.status(200).json({ success: true, data: note, message: 'Note updated.' });
  } catch (error) {
    console.error('Update note error:', error);
    return res.status(500).json({ success: false, error: 'Failed to update note.' });
  }
};

export const deleteNote = async (req, res) => {
  try {
    const { id, noteId } = req.params;
    const deleted = await TaskNote.findOneAndDelete({
      _id: noteId,
      taskId: id,
      organizationId: req.user.organizationId,
    });

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Note not found.' });
    }

    return res.status(200).json({ success: true, message: 'Note deleted.' });
  } catch (error) {
    console.error('Delete note error:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete note.' });
  }
};
