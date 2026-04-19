import mongoose from 'mongoose';

const purchaseSchema = new mongoose.Schema({
  name:            { type: String, required: true, trim: true },
  email:           { type: String, required: true, trim: true, lowercase: true },
  phone:           { type: String, required: true, trim: true },
  plan:            { type: String, default: 'Pro' },
  amount:          { type: Number, default: 1499 },
  currency:        { type: String, default: 'INR' },
  // 'new_lead' = landing page upgrade, 'whatsapp_addon' = WA feature addon purchase
  type:            { type: String, default: 'new_lead' },
  // For addon purchases: which features this purchase unlocks
  addonFeatures:   { type: [String], default: [] },
  addonBundle:     { type: Boolean, default: false },
  status:          { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  // Linked user (superadmin) for in-app upgrade flow
  userId:          { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Cashfree fields
  cashfreeLinkId:    { type: String, default: '', index: true }, // our link_id (unique per Purchase)
  cashfreeOrderId:   { type: String, default: '' },              // order_id once payment happens
  cashfreePaymentId: { type: String, default: '' },              // cf_payment_id from webhook
  cashfreeLinkStatus:{ type: String, default: '' },              // ACTIVE / PAID / EXPIRED / CANCELLED
  paymentUrl:        { type: String, default: '' },              // link_url to redirect user
  // Email
  invoiceEmailSent:  { type: Boolean, default: false },
  addonActivated:    { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('Purchase', purchaseSchema);
