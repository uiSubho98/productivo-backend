/**
 * Seed script: Create the product_owner account.
 * Usage: node src/scripts/seed-product-owner.js
 *
 * Creates dsubhojit063@gmail.com with password 123456 and role product_owner.
 * If the user already exists, updates their role to product_owner.
 */

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set in .env');
  process.exit(1);
}

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true },
  passwordHash: String,
  role: { type: String, enum: ['product_owner', 'superadmin', 'org_admin', 'employee'] },
  organizationId: { type: mongoose.Schema.Types.ObjectId, default: null },
  isActive: { type: Boolean, default: true },
  biometricEnabled: { type: Boolean, default: false },
  mpinEnabled: { type: Boolean, default: false },
  mpinHash: { type: String, default: null },
  resetOtp: { type: String, default: null },
  resetOtpExpiry: { type: Date, default: null },
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);

const OWNER_EMAIL = 'dsubhojit063@gmail.com';
const OWNER_PASSWORD = '123456';
const OWNER_NAME = 'Product Owner';

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.');

  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(OWNER_PASSWORD, salt);

  const existing = await User.findOne({ email: OWNER_EMAIL });

  if (existing) {
    existing.role = 'product_owner';
    existing.passwordHash = passwordHash;
    existing.isActive = true;
    existing.organizationId = null;
    await existing.save();
    console.log(`Updated existing user ${OWNER_EMAIL} → role: product_owner`);
  } else {
    await User.create({
      name: OWNER_NAME,
      email: OWNER_EMAIL,
      passwordHash,
      role: 'product_owner',
      organizationId: null,
      isActive: true,
    });
    console.log(`Created product_owner: ${OWNER_EMAIL}`);
  }

  await mongoose.disconnect();
  console.log('Done.');
}

run().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
