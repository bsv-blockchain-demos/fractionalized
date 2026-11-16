import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { connectRaw, ensureSchema } from '@server/lib/mongo';

/** Real in-memory Mongo for route tests. Call from beforeAll/afterAll/beforeEach. */
let mongod: MongoMemoryServer | undefined;

export async function startMongo() {
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('fraction_test');
  const db = await connectRaw();
  await ensureSchema(db.db);
  return db;
}

export async function stopMongo() {
  await (globalThis as { _fractionMongoClient?: { close(): Promise<void> } })._fractionMongoClient?.close();
  await mongod?.stop();
}

export async function clearMongo(db: Awaited<ReturnType<typeof connectRaw>>) {
  await Promise.all([
    db.propertiesCollection.deleteMany({}),
    db.sharesCollection.deleteMany({}),
    db.marketItemsCollection.deleteMany({}),
    db.locksCollection.deleteMany({}),
    db.listingBeefsCollection.deleteMany({}),
  ]);
}
