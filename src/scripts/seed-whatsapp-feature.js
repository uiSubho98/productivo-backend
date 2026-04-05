/**
 * Migration: ensure every superadmin has a WhatsappFeature record.
 * Existing superadmins default to isEnabled = false (locked).
 * Safe to run multiple times (upsert).
 *
 * Usage: node src/scripts/seed-whatsapp-feature.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const userSchema = new mongoose.Schema({ email: String, role: String }, { timestamps: true });
const featureSchema = new mongoose.Schema({
  superadminId: { type: mongoose.Schema.Types.ObjectId, unique: true },
  isEnabled: { type: Boolean, default: false },
  expiresAt: { type: Date, default: null },
  expiryLabel: { type: String, default: 'never' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  note: { type: String, default: '' },
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);
const WhatsappFeature = mongoose.models.WhatsappFeature || mongoose.model('WhatsappFeature', featureSchema);

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.');

  const superadmins = await User.find({ role: 'superadmin' }).select('_id email').lean();
  console.log(`Found ${superadmins.length} superadmin(s).`);

  let created = 0;
  let existing = 0;

  for (const sa of superadmins) {
    const result = await WhatsappFeature.findOneAndUpdate(
      { superadminId: sa._id },
      { $setOnInsert: { superadminId: sa._id, isEnabled: false, expiresAt: null, expiryLabel: 'never', note: '' } },
      { upsert: true, new: false }
    );
    if (!result) {
      created++;
      console.log(`  Created DISABLED record for ${sa.email}`);
    } else {
      existing++;
      console.log(`  Already exists for ${sa.email} — isEnabled=${result.isEnabled}`);
    }
  }

  console.log(`\nDone. Created: ${created}, Already existed: ${existing}`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error('Error:', err); process.exit(1); });
