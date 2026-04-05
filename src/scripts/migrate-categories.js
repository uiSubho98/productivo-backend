/**
 * Migration: categoryId (ObjectId | null) → categories (ObjectId[])
 *
 * Run with:  node src/scripts/migrate-categories.js
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
const tasks = db.collection('tasks');

// 1. Move any existing categoryId into a one-element categories array
const withCategory = await tasks.countDocuments({
  categoryId: { $exists: true, $ne: null },
});
console.log(`Tasks with a categoryId to migrate: ${withCategory}`);

if (withCategory > 0) {
  const result = await tasks.updateMany(
    { categoryId: { $exists: true, $ne: null }, categories: { $exists: false } },
    [{ $set: { categories: ['$categoryId'] } }]
  );
  console.log(`Migrated ${result.modifiedCount} tasks: categoryId → categories[]`);
}

// 2. Ensure every task has a categories array (even if empty)
const noArray = await tasks.countDocuments({ categories: { $exists: false } });
if (noArray > 0) {
  const r2 = await tasks.updateMany(
    { categories: { $exists: false } },
    { $set: { categories: [] } }
  );
  console.log(`Added empty categories[] to ${r2.modifiedCount} tasks`);
}

// 3. Drop the old categoryId field from all documents
const r3 = await tasks.updateMany(
  { categoryId: { $exists: true } },
  { $unset: { categoryId: '' } }
);
console.log(`Removed legacy categoryId field from ${r3.modifiedCount} tasks`);

// 4. Drop old index on categoryId if it exists, add index on categories
try {
  await tasks.dropIndex('categoryId_1');
  console.log('Dropped old index categoryId_1');
} catch {
  console.log('No old categoryId_1 index to drop (OK)');
}

await tasks.createIndex({ categories: 1 });
console.log('Created index on categories');

console.log('Migration complete.');
await mongoose.disconnect();
