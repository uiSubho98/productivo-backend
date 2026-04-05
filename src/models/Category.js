import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      trim: true,
      maxlength: 100,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

categorySchema.index({ organizationId: 1 });

export const DEFAULT_CATEGORIES = [
  'Backend',
  'Frontend',
  'Deployment',
  'PR Review',
  'Meetings',
];

const Category = mongoose.model('Category', categorySchema);

export default Category;
