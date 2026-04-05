/**
 * Seed script: Fix user roles + subscription plans.
 *
 * 1. 2022devify@gmail.com → role: superadmin (was wrongly org_admin)
 * 2. dsubhojit062@gmail.com → subscription plan: pro (1 year from now)
 *
 * Usage: node src/scripts/seed-fix-users.js
 */

import mongoose from 'mongoose';
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
}, { timestamps: true });

const subscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  plan: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
  status: { type: String, enum: ['active', 'expired', 'cancelled'], default: 'active' },
  expiresAt: { type: Date, default: null },
  purchaseId: { type: mongoose.Schema.Types.ObjectId, default: null },
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Subscription = mongoose.models.Subscription || mongoose.model('Subscription', subscriptionSchema);

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.\n');

  // ── 1. Fix 2022devify@gmail.com → superadmin ──────────────────────────────
  const devifyUser = await User.findOne({ email: '2022devify@gmail.com' });
  if (!devifyUser) {
    console.log('⚠  2022devify@gmail.com not found — skipping role fix.');
  } else {
    const oldRole = devifyUser.role;
    devifyUser.role = 'superadmin';
    devifyUser.isActive = true;
    await devifyUser.save();
    console.log(`✓  2022devify@gmail.com: role ${oldRole} → superadmin`);

    // Ensure free subscription exists for this user
    let sub = await Subscription.findOne({ userId: devifyUser._id });
    if (!sub) {
      sub = await Subscription.create({ userId: devifyUser._id, plan: 'free', status: 'active' });
      console.log(`✓  Created free subscription for 2022devify@gmail.com`);
    } else {
      console.log(`   Subscription already exists: plan=${sub.plan}`);
    }
  }

  // ── 2. dsubhojit062@gmail.com → pro subscription ─────────────────────────
  const proUser = await User.findOne({ email: 'dsubhojit062@gmail.com' });
  if (!proUser) {
    console.log('\n⚠  dsubhojit062@gmail.com not found — run seed-superadmin.js first.');
  } else {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 1); // 1 year from now

    let sub = await Subscription.findOne({ userId: proUser._id });
    if (sub) {
      sub.plan = 'pro';
      sub.status = 'active';
      sub.expiresAt = expiresAt;
      await sub.save();
      console.log(`\n✓  dsubhojit062@gmail.com: subscription upgraded to PRO (expires ${expiresAt.toDateString()})`);
    } else {
      await Subscription.create({
        userId: proUser._id,
        plan: 'pro',
        status: 'active',
        expiresAt,
      });
      console.log(`\n✓  dsubhojit062@gmail.com: created PRO subscription (expires ${expiresAt.toDateString()})`);
    }
  }

  console.log('\nDone.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
