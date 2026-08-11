import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  console.log('CONNECTING TO MONGO...');
  await mongoose.connect(process.env.MONGO_URI);
  console.log('CONNECTED.');

  const db = mongoose.connection.db;
  const collections = await db.listCollections().toArray();
  console.log('Collections:', collections.map(c => c.name));

  // Find some users
  const users = await db.collection('users').find({}).limit(5).toArray();
  console.log('Sample Users:', users);

  // Find some institutes
  const institutes = await db.collection('institutes').find({}).limit(5).toArray();
  console.log('Sample Institutes:', institutes);

  await mongoose.disconnect();
}

main().catch(console.error);
