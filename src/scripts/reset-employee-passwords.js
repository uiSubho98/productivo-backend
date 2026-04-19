/**
 * Reset every employee's password to their own email.
 * Scope: users with role === 'employee'.
 *
 * Usage: node src/scripts/reset-employee-passwords.js
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

const userSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, lowercase: true },
    passwordHash: String,
    role: { type: String, enum: ['product_owner', 'superadmin', 'org_admin', 'employee'] },
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model('User', userSchema);

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  const employees = await User.find({ role: 'employee' }).select('_id email');
  console.log(`Found ${employees.length} employees.\n`);

  let updated = 0;
  for (const emp of employees) {
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(emp.email, salt);
    await User.updateOne({ _id: emp._id }, { $set: { passwordHash } });
    updated += 1;
    console.log(`  ✓ ${emp.email}`);
  }

  console.log(`\nDone. Updated ${updated}/${employees.length} employees.`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Script error:', err);
  process.exit(1);
});
