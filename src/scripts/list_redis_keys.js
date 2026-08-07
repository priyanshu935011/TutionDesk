import "dotenv/config";
import redisClient from "../config/redis.js";

async function run() {
  try {
    console.log("Connecting to Redis...");
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    console.log("Connected.");

    const keys = [];
    for await (const key of redisClient.scanIterator({ MATCH: "*", COUNT: 100 })) {
      keys.push(key);
    }
    console.log("--- ALL REDIS KEYS ---");
    keys.forEach(k => console.log(k));

  } catch (err) {
    console.error("Error listing keys:", err);
  } finally {
    process.exit(0);
  }
}

run();
