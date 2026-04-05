/**
 * Seeds default categories for every organization that doesn't have them yet.
 * Run with:  node src/scripts/seed-categories-all-orgs.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import mongoose from 'mongoose';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '../../.env') });

await mongoose.connect(process.env.MONGODB_URI);
console.log('Connected to MongoDB');

const db = mongoose.connection.db;
const orgs = db.collection('organizations');
const categories = db.collection('categories');

const DEFAULT_CATEGORIES = ['Backend', 'Frontend', 'Deployment', 'PR Review', 'Meetings'];

const allOrgs = await orgs.find({}).toArray();
console.log(`Found ${allOrgs.length} organizations`);

for (const org of allOrgs) {
  const existing = await categories
    .find({ organizationId: org._id, isDefault: true })
    .toArray();
  const existingNames = existing.map((c) => c.name);
  const toCreate = DEFAULT_CATEGORIES.filter((n) => !existingNames.includes(n));

  if (toCreate.length === 0) {
    console.log(`  ${org.name}: all defaults already present`);
    continue;
  }

  await categories.insertMany(
    toCreate.map((name) => ({
      name,
      organizationId: org._id,
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))
  );
  console.log(`  ${org.name}: seeded [${toCreate.join(', ')}]`);
}

console.log('Seed complete.');
await mongoose.disconnect();
