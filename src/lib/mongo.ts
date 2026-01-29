import { MongoClient, ServerApiVersion, Db, Collection, ObjectId } from "mongodb";
import dotenv from "dotenv";
dotenv.config();
import { propertiesValidator, sharesValidator, propertyDescriptionsValidator, marketItemsValidator } from "./validators";

export interface Properties {
  _id: ObjectId;
  title: string;
  location: string;
  priceUSD: number;
  investors: number;
  status: string;
  annualisedReturn: string;
  currentValuationUSD: number;
  grossYield: string;
  netYield: string;
  investmentBreakdown: {
    purchaseCost: number;
    transactionCost: number;
    runningCost: number;
  },
  features: Record<string, number>,
  images: string[],
  txids: {
    tokenTxid: string;
    originalMintTxid?: string; // Immutable original mint transaction
    currentOutpoint?: string; // Current UTXO for next purchase (change output)
    paymentTxid?: string;
    mintTxid?: string; // Deprecated - kept for backward compatibility
  },
  seller: string,
  sell?: {
    percentToSell: number;
    remainingPercent?: number; // Tracks remaining shares available for purchase
  },
  proofOfOwnership?: string, // Base64 encoded PDF document
}

export interface PropertyDescription {
  _id?: ObjectId;
  propertyId: ObjectId;
  description: {
    details: string;
    features: string[];
  };
  whyInvest?: { title: string; text: string }[];
}

export interface ShareLock {
  _id: ObjectId;
  propertyId: ObjectId;
  investorId: string;
  createdAt: Date;
}

export interface Shares {
  _id: ObjectId;
  propertyId: ObjectId;
  investorId: string;
  parentTxid: string;
  transferTxid: string;
  amount: number;
  createdAt: Date;
}

export interface MarketItem {
  _id: ObjectId; // mongo id
  propertyId: ObjectId; // property id
  sellerId: string; // seller pubkey
  shareId: ObjectId; // share id
  sellAmount: number; // sell amount
  pricePerShare: number; // price per share
  createdAt: Date; // created at
  sold?: boolean; // sold
};

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
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in environment variables');
  }
  const dbName = getDatabaseNameFromUri(uri);
  return { uri, dbName };
}

// Client will be initialized on first connection
let client: MongoClient | null = null;

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

// Track if we're currently connecting to prevent race conditions
let connectingPromise: Promise<void> | null = null;

// Connect to MongoDB
async function connectToMongo() {
  // If already connected, return immediately
  if (db) {
    return { db, propertiesCollection, sharesCollection, locksCollection, propertyDescriptionsCollection, marketItemsCollection };
  }

  // If currently connecting, wait for that to finish
  if (connectingPromise) {
    await connectingPromise;
    return { db, propertiesCollection, sharesCollection, locksCollection, propertyDescriptionsCollection, marketItemsCollection };
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
        console.log("Connected to MongoDB!");
      } else {
        // Reuse existing client if already connected
        console.log("Reusing existing MongoDB connection");
      }

      // Initialize database and collections
      db = client.db(dbName);
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
          console.warn("collMod properties failed (will continue):", e);
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
          console.warn("collMod shares failed (will continue):", e);
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
          console.warn("collMod property_descriptions failed (will continue):", e);
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
          console.warn("collMod market_items failed (will continue):", e);
        }
      }

      // share locks (no validator needed)
      if (!existing.has("share_locks")) {
        await db.createCollection("share_locks");
      }

      // Get typed collection handles
      propertiesCollection = db.collection("properties");
      sharesCollection = db.collection("shares");
      locksCollection = db.collection("share_locks");
      propertyDescriptionsCollection = db.collection("property_descriptions");
      marketItemsCollection = db.collection("market_items");

      // Create indexes for better performance
      await propertiesCollection.createIndex({ "_id": 1 });
      // Ensure unique tokenTxid only when present (partial unique index)
      try {
        const desiredIndexName = "txids.tokenTxid_unique";
        // Drop conflicting legacy index if present (e.g., auto-named txids.tokenTxid_1)
        const existingIndexes = await propertiesCollection.listIndexes().toArray().catch(() => [] as any[]);
        // Attempt to drop any legacy lowercase or uppercase index variants
        const conflictingIndexes = existingIndexes.filter((i: any) => (
          i.name === "txids.tokenTxid_1" ||
          i.name === "txids.TokenTxid_1" ||
          (i.key && (i.key["txids.tokenTxid"] === 1 || i.key["txids.TokenTxid"] === 1) && i.name !== desiredIndexName)
        ));
        for (const idx of conflictingIndexes) {
          try { await propertiesCollection.dropIndex(idx.name); } catch { }
        }
        await propertiesCollection.createIndex(
          { "txids.tokenTxid": 1 },
          {
            name: desiredIndexName,
            unique: true,
            partialFilterExpression: { "txids.tokenTxid": { $type: "string" } },
          }
        );
      } catch (e) {
        console.warn("Ensuring txids.tokenTxid index failed (will continue):", e);
      }

      await sharesCollection.createIndex({ "_id": 1 });
      // For quick lookup of latest share for a property and per investor
      await sharesCollection.createIndex({ propertyId: 1, createdAt: -1 });
      await sharesCollection.createIndex({ propertyId: 1, investorId: 1, createdAt: -1 });
      // Ensure each transfer outpoint is unique per property and speed up parent lookups for chain tracing
      await sharesCollection.createIndex({ propertyId: 1, transferTxid: 1 }, { unique: true });
      await sharesCollection.createIndex({ propertyId: 1, parentTxid: 1 });
      // Join index for property descriptions
      await propertyDescriptionsCollection.createIndex({ propertyId: 1 }, { unique: true });
      // Concurrency lock unique per (propertyId, investorId)
      await locksCollection.createIndex({ propertyId: 1, investorId: 1 }, { unique: true });
      // Market items unique per (propertyId, shareId)
      await marketItemsCollection.createIndex({ propertyId: 1, sellerId: 1 });

      // Note: _id is automatically unique in MongoDB, no need for custom id field

      console.log("MongoDB indexes created successfully");
    } catch (error) {
      console.error("Error connecting to MongoDB:", error);
      connectingPromise = null; // Reset on error so retry is possible
      throw error;
    } finally {
      connectingPromise = null; // Clear the connecting promise
    }
  })();

  await connectingPromise;
  return { db, propertiesCollection, sharesCollection, locksCollection, propertyDescriptionsCollection, marketItemsCollection };
}

// Handle application shutdown (only in non-serverless environments)
if (typeof process !== 'undefined' && process.on) {
  process.on('SIGINT', async () => {
    try {
      if (client) {
        await client.close();
        console.log('MongoDB connection closed.');
      }
      process.exit(0);
    } catch (error) {
      console.error('Error during MongoDB shutdown:', error);
      process.exit(1);
    }
  });
}

export { connectToMongo, propertiesCollection, sharesCollection, locksCollection, propertyDescriptionsCollection, marketItemsCollection };
