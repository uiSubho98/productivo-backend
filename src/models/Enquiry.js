import mongoose from 'mongoose';

const enquirySchema = new mongoose.Schema({
  fullName:    { type: String, required: true, trim: true },
  email:       { type: String, required: true, trim: true, lowercase: true },
  phone:       { type: String, required: true, trim: true },
  description: { type: String, required: true, trim: true },
  source:      { type: String, default: 'landing_page' },
  status:      { type: String, enum: ['new', 'contacted', 'converted', 'closed'], default: 'new' },
  notes:       { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('Enquiry', enquirySchema);
