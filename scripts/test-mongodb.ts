/**
 * Quick MongoDB connection test. Loads .env and pings the cluster.
 * Run: npx tsx scripts/test-mongodb.ts
 */
import "dotenv/config";
import { MongoClient, ServerApiVersion } from "mongodb";

const uri = (process.env.MONGODB_URI ?? "").trim().replace(/^["']|["']$/g, "");
if (!uri) {
  console.error("MONGODB_URI is not set in .env");
  process.exit(1);
}

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
});

async function run() {
  try {
    console.log("Connecting to MongoDB...");
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
    process.exit(0);
  } catch (err) {
    console.error("Connection failed:", err);
    process.exit(1);
  } finally {
    await client.close();
  }
}
run();
