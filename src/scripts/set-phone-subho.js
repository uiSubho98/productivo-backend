/**
 * One-off: set phoneNumber for dsubhojit062@gmail.com to 8777468277.
 * Idempotent — safe to re-run.
 *
 * Usage: node src/scripts/set-phone-subho.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const TARGET_EMAIL = 'dsubhojit062@gmail.com';
const TARGET_PHONE = '8777468277';

async function run() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected.');

  const result = await mongoose.connection.db
    .collection('users')
    .updateOne(
      { email: TARGET_EMAIL },
      { $set: { phoneNumber: TARGET_PHONE, phoneEditUntil: null } }
    );

  if (result.matchedCount === 0) {
    console.log(`No user found with email ${TARGET_EMAIL}`);
  } else {
    console.log(`Updated ${TARGET_EMAIL}: phoneNumber = ${TARGET_PHONE} (modified=${result.modifiedCount})`);
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
