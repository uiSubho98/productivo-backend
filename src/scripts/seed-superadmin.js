/**
 * Seed script: Create/update dsubhojit062@gmail.com as superadmin
 * with master org "Devifai_Master".
 *
 * Usage: node src/scripts/seed-superadmin.js
 *
 * - Creates "Devifai_Master" org (or renames existing one linked to this user)
 * - Sets dsubhojit062@gmail.com as superadmin with password 123456
 * - Sets org.superadminId = user._id  (required for isolation scoping)
 * - If user already exists, updates role + org
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

// Minimal schemas — enough to create/update documents
const orgSchema = new mongoose.Schema({
  name: String,
  phone: String,
  address: Object,
  adminIds: [{ type: mongoose.Schema.Types.ObjectId }],
  superadminId: { type: mongoose.Schema.Types.ObjectId, default: null },
  parentOrgId: { type: mongoose.Schema.Types.ObjectId, default: null },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

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

const Organization = mongoose.models.Organization || mongoose.model('Organization', orgSchema);
const User = mongoose.models.User || mongoose.model('User', userSchema);

const SUPERADMIN_EMAIL = 'dsubhojit062@gmail.com';
const SUPERADMIN_PASSWORD = '123456';
const SUPERADMIN_NAME = 'Subhojit Dutta';
const MASTER_ORG_NAME = 'Devifai_Master';

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB.');

  const salt = await bcrypt.genSalt(12);
  const passwordHash = await bcrypt.hash(SUPERADMIN_PASSWORD, salt);

  let user = await User.findOne({ email: SUPERADMIN_EMAIL });

  // If user already has an org, reuse it (we will rename it); otherwise create a new one
  let org;
  if (user?.organizationId) {
    org = await Organization.findById(user.organizationId);
    if (org) {
      if (org.name !== MASTER_ORG_NAME) {
        org.name = MASTER_ORG_NAME;
        await org.save();
        console.log(`Renamed existing org to: ${MASTER_ORG_NAME} (${org._id})`);
      } else {
        console.log(`Reusing existing org: ${org.name} (${org._id})`);
      }
    } else {
      org = null; // was deleted — recreate
    }
  }

  if (!org) {
    // Create fresh master org — superadminId will be set after user is created/found
    org = await Organization.create({
      name: MASTER_ORG_NAME,
      adminIds: [],
      superadminId: null,
      parentOrgId: null,
    });
    console.log(`Created master org: ${org.name} (${org._id})`);
  }

  if (user) {
    user.role = 'superadmin';
    user.passwordHash = passwordHash;
    user.organizationId = org._id;
    user.isActive = true;
    await user.save();
    console.log(`Updated existing user ${SUPERADMIN_EMAIL} → role: superadmin, org: ${org.name}`);
  } else {
    user = await User.create({
      name: SUPERADMIN_NAME,
      email: SUPERADMIN_EMAIL,
      passwordHash,
      role: 'superadmin',
      organizationId: org._id,
      isActive: true,
    });
    console.log(`Created superadmin: ${SUPERADMIN_EMAIL} in org: ${org.name}`);
  }

  // Ensure org.superadminId is set to this user (critical for isolation)
  if (!org.superadminId || org.superadminId.toString() !== user._id.toString()) {
    org.superadminId = user._id;
    await org.save();
    console.log(`Set org.superadminId = ${user._id} (${SUPERADMIN_EMAIL})`);
  }

  // Ensure user is in org's adminIds
  if (!org.adminIds.map(String).includes(String(user._id))) {
    org.adminIds.push(user._id);
    await org.save();
    console.log(`Added ${SUPERADMIN_EMAIL} to org adminIds.`);
  }

  console.log('\nSummary:');
  console.log(`  Email   : ${SUPERADMIN_EMAIL}`);
  console.log(`  Password: ${SUPERADMIN_PASSWORD}`);
  console.log(`  Role    : superadmin`);
  console.log(`  Org     : ${org.name} (${org._id})`);
  console.log(`  Master  : yes (parentOrgId = null)`);

  await mongoose.disconnect();
  console.log('\nDone.');
}

run().catch((err) => {
  console.error('Seed error:', err);
  process.exit(1);
});
