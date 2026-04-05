import Category, { DEFAULT_CATEGORIES } from '../models/Category.js';

export const create = async (req, res) => {
  try {
    const { name, organizationId: bodyOrgId } = req.body;
    const orgId = req.user.role === 'product_owner' && bodyOrgId
      ? bodyOrgId
      : req.user.organizationId;

    if (!orgId) {
      return res.status(400).json({ success: false, error: 'organizationId is required.' });
    }

    const category = await Category.create({
      name,
      organizationId: orgId,
      isDefault: false,
    });

    return res.status(201).json({
      success: true,
      data: category,
      message: 'Category created.',
    });
  } catch (error) {
    console.error('Create category error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to create category.',
    });
  }
};

export const getAll = async (req, res) => {
  try {
    const { organizationId: queryOrgId } = req.query;
    const orgId = req.user.role === 'product_owner' && queryOrgId
      ? queryOrgId
      : req.user.organizationId;

    const categories = await Category.find({
      organizationId: orgId,
    }).sort({ isDefault: -1, name: 1 });

    return res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error('Get categories error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch categories.',
    });
  }
};

export const update = async (req, res) => {
  try {
    const { name } = req.body;

    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, organizationId: req.user.organizationId },
      { name },
      { new: true, runValidators: true }
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found.',
      });
    }

    return res.status(200).json({
      success: true,
      data: category,
      message: 'Category updated.',
    });
  } catch (error) {
    console.error('Update category error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update category.',
    });
  }
};

export const remove = async (req, res) => {
  try {
    const category = await Category.findOneAndDelete({
      _id: req.params.id,
      organizationId: req.user.organizationId,
      isDefault: false,
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found or cannot delete default category.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Category deleted.',
    });
  } catch (error) {
    console.error('Delete category error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete category.',
    });
  }
};

export const seedDefaults = async (req, res) => {
  try {
    const { organizationId: bodyOrgId } = req.body;
    const orgId = req.user.role === 'product_owner' && bodyOrgId
      ? bodyOrgId
      : req.user.organizationId;

    if (!orgId) {
      return res.status(400).json({ success: false, error: 'organizationId is required.' });
    }

    const existing = await Category.find({
      organizationId: orgId,
      isDefault: true,
    });

    const existingNames = existing.map((c) => c.name);
    const toCreate = DEFAULT_CATEGORIES.filter((name) => !existingNames.includes(name));

    if (toCreate.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Default categories already exist.',
      });
    }

    const categories = await Category.insertMany(
      toCreate.map((name) => ({
        name,
        organizationId: orgId,
        isDefault: true,
      }))
    );

    return res.status(201).json({
      success: true,
      data: categories,
      message: `${categories.length} default categories seeded.`,
    });
  } catch (error) {
    console.error('Seed categories error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to seed default categories.',
    });
  }
};
