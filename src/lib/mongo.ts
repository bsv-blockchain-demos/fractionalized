import { MongoClient, ServerApiVersion, Db, Collection, ObjectId } from "mongodb";
import dotenv from "dotenv";
dotenv.config();
import { propertiesValidator, sharesValidator, propertyDescriptionsValidator, marketItemsValidator } from "./validators";

export interface Properties {
    _id: ObjectId;
    title: string;
    location: string;
    priceAED: number;
    investors: number;
    status: string;
    annualisedReturn: string;
    currentValuationAED: number;
    grossYield: string;
    netYield: string;
    investmentBreakdown: {
        purchaseCost: number;
        transactionCost: number;
        runningCost: number;
    },
    features: Record<string, number>,
    images: string[],
    txids: Record<string, string>,
    seller: string,
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
    investorId: ObjectId;
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

// Use environment variable for MongoDB URI or fallback to hardcoded value
const uri = process.env.MONGODB_URI as string;
const clusterName = process.env.MONGODB_CLUSTER_NAME as string;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Database and collections
let db: Db;
let propertiesCollection: Collection<Properties>;
let sharesCollection: Collection<Shares>;
let locksCollection: Collection<ShareLock>;
let propertyDescriptionsCollection: Collection<PropertyDescription>;
let marketItemsCollection: Collection<MarketItem>;

// Connect to MongoDB
async function connectToMongo() {
  if (!db) {
    try {
      // Connect the client to the server
      await client.connect();
      console.log("Connected to MongoDB!");
      
      // Initialize database and collections
      db = client.db(clusterName);
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
      await propertiesCollection.createIndex({ "txids.tokenTxid": 1 }, { unique: true });

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
      throw error;
    }
  }
  return { db, propertiesCollection, sharesCollection, locksCollection, propertyDescriptionsCollection, marketItemsCollection };
}

// Connect immediately when this module is imported
connectToMongo().catch(console.error);

// Handle application shutdown
process.on('SIGINT', async () => {
  try {
    await client.close();
    console.log('MongoDB connection closed.');
    process.exit(0);
  } catch (error) {
    console.error('Error during MongoDB shutdown:', error);
    process.exit(1);
  }
});

export { connectToMongo, propertiesCollection, sharesCollection, locksCollection, propertyDescriptionsCollection, marketItemsCollection };
