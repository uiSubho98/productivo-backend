import mongoose from 'mongoose';

const purchaseSchema = new mongoose.Schema({
  name:            { type: String, required: true, trim: true },
  email:           { type: String, required: true, trim: true, lowercase: true },
  phone:           { type: String, required: true, trim: true },
  plan:            { type: String, default: 'Pro' },
  amount:          { type: Number, default: 1499 },
  currency:        { type: String, default: 'INR' },
  type:            { type: String, default: 'new_lead' },
  status:          { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  // Linked user (superadmin) for in-app upgrade flow
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Instamojo fields
  paymentRequestId:  { type: String, default: '' },
  paymentId:         { type: String, default: '' },
  paymentUrl:        { type: String, default: '' },
  instamojoStatus:   { type: String, default: '' },
  // Email
  invoiceEmailSent:  { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('Purchase', purchaseSchema);
