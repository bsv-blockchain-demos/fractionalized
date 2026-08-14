import { MongoClient, ServerApiVersion, Db, Collection, Document } from "mongodb";
import dotenv from "dotenv";
// Server-only module: env comes from server/.env, never the client's root .env.
dotenv.config({ path: "server/.env" });
import { propertiesValidator, sharesValidator, propertyDescriptionsValidator, marketItemsValidator } from "./validators";
import { getMongoUri } from "./config";
import { logger } from "@shared/logger";

// Document shapes live in shared/ so the client can import them without the
// Mongo driver. Re-exported here so existing `from './mongo'` importers still work
// (and imported locally since this file uses them in `Collection<T>` handles below).
import type {
  Properties, PropertyDescription, ShareLock, Shares, MarketItem, ListingBeef,
} from '../../shared/types';
export type { Properties, PropertyDescription, ShareLock, Shares, MarketItem, ListingBeef };

// Extract database name from URI
function getDatabaseNameFromUri(connectionUri: string): string {
  try {
    // Parse the URI to extract the database name
    const url = new URL(connectionUri.replace('mongodb+srv://', 'http://').replace('mongodb://', 'http://'));
    const dbName = url.pathname.slice(1).split('?')[0]; // Remove leading '/' and query params

    if (!dbName) {
      throw new Error('Database name not found in MONGODB_URI. Please include the database name in the connection string (e.g., mongodb+srv://user:pass@cluster.mongodb.net/supplychain)');
    }

    return dbName;
  } catch (error) {
    if (error instanceof Error && error.message.includes('Database name not found')) {
      throw error;
    }
    throw new Error('Failed to parse MONGODB_URI. Please ensure it is a valid MongoDB connection string with a database name.');
  }
}

// Lazy initialization - only get env vars when actually connecting
function getMongoConfig() {
  const uri = getMongoUri();
  const dbName = getDatabaseNameFromUri(uri);
  return { uri, dbName };
}

// Cache the client on globalThis so warm serverless invocations and Next dev HMR reuse one connection.
const globalForMongo = globalThis as unknown as { _fractionMongoClient?: MongoClient };
let client: MongoClient | null = globalForMongo._fractionMongoClient ?? null;

// Connection options with pooling configuration
const options = {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  maxPoolSize: 10, // Maximum number of connections in the pool
  minPoolSize: 2,  // Minimum number of connections to maintain
  maxIdleTimeMS: 30000, // Close connections that have been idle for 30 seconds
};

// Database and collections (initialized on first connection)
let db: Db;
let propertiesCollection: Collection<Properties>;
let sharesCollection: Collection<Shares>;
let locksCollection: Collection<ShareLock>;
let propertyDescriptionsCollection: Collection<PropertyDescription>;
let marketItemsCollection: Collection<MarketItem>;
let listingBeefsCollection: Collection<ListingBeef>;

// Track if we're currently connecting to prevent race conditions
let connectingPromise: Promise<void> | null = null;

// Track whether required-index assertion has already run this process (cold start)
let indexesAsserted = false;

// Deploy-time schema setup: creates/collMods collections with validators and creates indexes.
// Called ONLY by scripts/db-migrate.ts (via `npm run db:migrate`) — never on the request path.
export async function ensureSchema(db: Db): Promise<void> {
  // Ensure collections exist with validators applied
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));

  // properties collection
  if (!existing.has("properties")) {
    await db.createCollection("properties", {
      validator: propertiesValidator as any,
      validationLevel: "strict",
    });
  } else {
    try {
      await db.command({
        collMod: "properties",
        validator: propertiesValidator,
        validationLevel: "strict",
      });
    } catch (e) {
      logger.warn("collMod properties failed (will continue):", e);
    }
  }

  // shares collection
  if (!existing.has("shares")) {
    await db.createCollection("shares", {
      validator: sharesValidator as any,
      validationLevel: "strict",
    });
  } else {
    try {
      await db.command({
        collMod: "shares",
        validator: sharesValidator,
        validationLevel: "strict",
      });
    } catch (e) {
      logger.warn("collMod shares failed (will continue):", e);
    }
  }

  // property_descriptions collection
  if (!existing.has("property_descriptions")) {
    await db.createCollection("property_descriptions", {
      validator: propertyDescriptionsValidator as any,
      validationLevel: "strict",
    });
  } else {
    try {
      await db.command({
        collMod: "property_descriptions",
        validator: propertyDescriptionsValidator,
        validationLevel: "strict",
      });
    } catch (e) {
      logger.warn("collMod property_descriptions failed (will continue):", e);
    }
  }

  // market_items collection
  if (!existing.has("market_items")) {
    await db.createCollection("market_items", {
      validator: marketItemsValidator as any,
      validationLevel: "strict",
    });
  } else {
    try {
      await db.command({
        collMod: "market_items",
        validator: marketItemsValidator,
        validationLevel: "strict",
      });
    } catch (e) {
      logger.warn("collMod market_items failed (will continue):", e);
    }
  }

  // share locks (no validator needed)
  if (!existing.has("share_locks")) {
    await db.createCollection("share_locks");
  }

  // listing_beefs (no validator needed)
  if (!existing.has("listing_beefs")) {
    await db.createCollection("listing_beefs");
  }

  // Get typed collection handles (local to this function — ensureSchema receives only `db`)
  const propertiesColl = db.collection("properties");
  const sharesColl = db.collection("shares");
  const locksColl = db.collection("share_locks");
  const propertyDescriptionsColl = db.collection("property_descriptions");
  const marketItemsColl = db.collection("market_items");
  const listingBeefsColl = db.collection("listing_beefs");

  // Create indexes for better performance
  await propertiesColl.createIndex({ "_id": 1 });
  // Ensure unique tokenTxid only when present (partial unique index)
  try {
    const desiredIndexName = "txids.tokenTxid_unique";
    // Drop conflicting legacy index if present (e.g., auto-named txids.tokenTxid_1)
    const existingIndexes = await propertiesColl.listIndexes().toArray().catch(() => [] as any[]);
    // Attempt to drop any legacy lowercase or uppercase index variants
    const conflictingIndexes = existingIndexes.filter((i: any) => (
      i.name === "txids.tokenTxid_1" ||
      i.name === "txids.TokenTxid_1" ||
      (i.key && (i.key["txids.tokenTxid"] === 1 || i.key["txids.TokenTxid"] === 1) && i.name !== desiredIndexName)
    ));
    for (const idx of conflictingIndexes) {
      try { await propertiesColl.dropIndex(idx.name); } catch { }
    }
    await propertiesColl.createIndex(
      { "txids.tokenTxid": 1 },
      {
        name: desiredIndexName,
        unique: true,
        partialFilterExpression: { "txids.tokenTxid": { $type: "string" } },
      }
    );
  } catch (e) {
    logger.warn("Ensuring txids.tokenTxid index failed (will continue):", e);
  }

  await sharesColl.createIndex({ "_id": 1 });
  // For quick lookup of latest share for a property and per investor
  await sharesColl.createIndex({ propertyId: 1, createdAt: -1 });
  await sharesColl.createIndex({ propertyId: 1, investorId: 1, createdAt: -1 });
  // Ensure each transfer outpoint is unique per property and speed up parent lookups for chain tracing
  await sharesColl.createIndex({ propertyId: 1, transferTxid: 1 }, { unique: true });
  await sharesColl.createIndex({ propertyId: 1, parentTxid: 1 });
  // Join index for property descriptions
  await propertyDescriptionsColl.createIndex({ propertyId: 1 }, { unique: true });
  // Concurrency lock unique per (propertyId, investorId)
  await locksColl.createIndex({ propertyId: 1, investorId: 1 }, { unique: true });
  // Market items unique per (propertyId, shareId)
  await marketItemsColl.createIndex({ propertyId: 1, sellerId: 1 });
  // Listing beefs unique per listingId
  await listingBeefsColl.createIndex({ listingId: 1 }, { unique: true });

  // Note: _id is automatically unique in MongoDB, no need for custom id field

  // auth_nonces: single-use nonce store for replay protection (moved from authNonceStore.ts)
  const existingNames = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
  if (!existingNames.has("auth_nonces")) {
    await db.createCollection("auth_nonces");
  }
  await db.collection("auth_nonces").createIndex({ nonce: 1 }, { unique: true });
  await db.collection("auth_nonces").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  logger.debug("MongoDB schema ensured");
}

// Read-only check run on connect: refuse to serve if a security/correctness-critical
// unique index is missing (i.e. `npm run db:migrate` was not run). Creates nothing.
const REQUIRED_UNIQUE_INDEXES: { collection: string; key: Record<string, 1 | -1> }[] = [
  { collection: "auth_nonces", key: { nonce: 1 } },                 // replay protection
  { collection: "shares", key: { propertyId: 1, transferTxid: 1 } }, // no duplicate outpoints
  { collection: "share_locks", key: { propertyId: 1, investorId: 1 } }, // concurrency lock
];

export async function assertRequiredIndexes(db: Db): Promise<void> {
  for (const req of REQUIRED_UNIQUE_INDEXES) {
    const idxs = await db.collection(req.collection).indexes().catch(() => [] as Document[]);
    const ok = idxs.some((i) => i.unique === true && JSON.stringify(i.key) === JSON.stringify(req.key));
    if (!ok) {
      throw new Error(`Required unique index missing on ${req.collection} ${JSON.stringify(req.key)} — run "npm run db:migrate"`);
    }
  }
}

// Connect + assign collection handles ONLY. Creates nothing. Used directly by scripts/db-migrate.ts
// (which must bootstrap a fresh DB before any index can exist) and internally by connectToMongo.
async function connectRaw() {
  // If already connected, return immediately
  if (db) {
    return { db, propertiesCollection, sharesCollection, locksCollection, propertyDescriptionsCollection, marketItemsCollection, listingBeefsCollection };
  }

  // If currently connecting, wait for that to finish
  if (connectingPromise) {
    await connectingPromise;
    return { db, propertiesCollection, sharesCollection, locksCollection, propertyDescriptionsCollection, marketItemsCollection, listingBeefsCollection };
  }

  // Start new connection
  connectingPromise = (async () => {
    try {
      // Get config only when actually connecting
      const { uri, dbName } = getMongoConfig();

      // Initialize client if not already done
      if (!client) {
        client = new MongoClient(uri, options);
        await client.connect();
        globalForMongo._fractionMongoClient = client;
        logger.debug("Connected to MongoDB!");
      } else {
        // Reuse existing client if already connected
        logger.debug("Reusing existing MongoDB connection");
      }

      // Initialize database and collections
      db = client.db(dbName);

      // Get typed collection handles (no schema/index setup here)
      propertiesCollection = db.collection("properties");
      sharesCollection = db.collection("shares");
      locksCollection = db.collection("share_locks");
      propertyDescriptionsCollection = db.collection("property_descriptions");
      marketItemsCollection = db.collection("market_items");
      listingBeefsCollection = db.collection("listing_beefs");
    } catch (error) {
      logger.error("Error connecting to MongoDB:", error);
      // Drop the half-initialized client so a retry reconnects instead of reusing a broken
      // instance (otherwise a failed initial connect would need a process restart to recover).
      try { await client?.close(); } catch { /* ignore */ }
      client = null;
      globalForMongo._fractionMongoClient = undefined;
      throw error;
    } finally {
      connectingPromise = null; // Clear the connecting promise so a retry can start
    }
  })();

  await connectingPromise;
  return { db, propertiesCollection, sharesCollection, locksCollection, propertyDescriptionsCollection, marketItemsCollection, listingBeefsCollection };
}

// Connect to MongoDB — connects, assigns handles, and fail-fasts if required indexes are missing.
// Creates nothing. Run `npm run db:migrate` (which calls ensureSchema) to create schema/indexes.
async function connectToMongo() {
  const handles = await connectRaw();
  if (!indexesAsserted) {
    await assertRequiredIndexes(handles.db);
    indexesAsserted = true;
  }
  return handles;
}

// Handle application shutdown (only in non-serverless environments)
if (typeof process !== 'undefined' && process.on) {
  process.on('SIGINT', async () => {
    try {
      if (client) {
        await client.close();
        logger.debug('MongoDB connection closed.');
      }
      process.exit(0);
    } catch (error) {
      logger.error('Error during MongoDB shutdown:', error);
      process.exit(1);
    }
  });
}

export { connectToMongo, connectRaw, propertiesCollection, sharesCollection, locksCollection, propertyDescriptionsCollection, marketItemsCollection, listingBeefsCollection };
