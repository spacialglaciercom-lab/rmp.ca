import { MongoClient, ServerApiVersion } from "mongodb";
import { ENV } from "./_core/env";
import { createLogger } from "./logger";

const log = createLogger("mongodb");

let client: MongoClient | null = null;

/**
 * Get the MongoDB client. Creates it lazily using MONGODB_URI from env.
 * Returns null if MONGODB_URI is not set.
 */
export function getMongoClient(): MongoClient | null {
  if (!ENV.mongodbUri) return null;
  if (!client) {
    client = new MongoClient(ENV.mongodbUri, {
      serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
      },
    });
  }
  return client;
}

/**
 * Connect the client to the server and ping to confirm a successful connection.
 * Call this at startup if you want to verify MongoDB is reachable.
 */
export async function connectAndPing(): Promise<boolean> {
  const c = getMongoClient();
  if (!c) {
    log.info("Skipped (no MONGODB_URI)");
    return false;
  }
  try {
    await c.connect();
    await c.db("admin").command({ ping: 1 });
    log.info("Pinged deployment. Connected to MongoDB.");
    return true;
  } catch (err) {
    log.warn("Connection failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * Close the MongoDB client. Call when shutting down the server.
 */
export async function closeMongoClient(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
