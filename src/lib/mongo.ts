import { MongoClient, ServerApiVersion, Db, Collection, ObjectId } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

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
        propertyPrice: number;
        purchaseCost: number;
        transactionCost: number;
        runningCost: number;
    },
    description: {
        details: string;
        features: string[];
    },
    features: string[],
    images: string[],
}

export interface Shares {
    _id: ObjectId;
    propertyId: ObjectId;
    investorId: ObjectId;
    amount: number;
    createdAt: Date;
    outpoint: string;
}

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

// Connect to MongoDB
async function connectToMongo() {
  if (!db) {
    try {
      // Connect the client to the server
      await client.connect();
      console.log("Connected to MongoDB!");
      
      // Initialize database and collections
      db = client.db(clusterName);
      propertiesCollection = db.collection("properties");
      sharesCollection = db.collection("shares");
      
      // Create indexes for better performance
      await propertiesCollection.createIndex({ "_id": 1 });

      await sharesCollection.createIndex({ "_id": 1 });
      
      // Note: _id is automatically unique in MongoDB, no need for custom id field
      
      console.log("MongoDB indexes created successfully");
    } catch (error) {
      console.error("Error connecting to MongoDB:", error);
      throw error;
    }
  }
  return { db, propertiesCollection, sharesCollection };
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

export { connectToMongo, propertiesCollection, sharesCollection };
