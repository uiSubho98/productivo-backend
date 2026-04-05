import mongoose from 'mongoose';

const projectMemberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      default: '',
    },
    whatsappNumber: {
      type: String,
      default: '',
    },
    countryCode: {
      type: String,
      default: '+91',
    },
    // 'employee' = org member, 'client' = external client, 'maintainer' = stakeholder
    role: {
      type: String,
      enum: ['employee', 'client', 'maintainer'],
      default: 'employee',
    },
  },
  { _id: true }
);

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Project name is required'],
      trim: true,
      maxlength: 200,
    },
    description: {
      type: String,
      default: '',
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
    },
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
      required: true,
    },
    status: {
      type: String,
      enum: ['planning', 'active', 'on_hold', 'completed', 'cancelled'],
      default: 'planning',
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    domain: {
      type: String,
      default: null,
      trim: true,
    },
    envFile: {
      type: String,
      default: null,
    },
    // All people connected to this project: employees, clients, maintainers
    members: {
      type: [projectMemberSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

projectSchema.index({ organizationId: 1 });
projectSchema.index({ clientId: 1 });

const Project = mongoose.model('Project', projectSchema);

export default Project;
