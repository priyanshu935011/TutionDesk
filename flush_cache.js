import "dotenv/config";
import redisClient from "./src/config/redis.js";

async function run() {
  try {
    console.log("Connecting to Redis...");
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    console.log("Connected successfully.");

    const keys = [];
    for await (const key of redisClient.scanIterator({ MATCH: "*", COUNT: 100 })) {
      keys.push(key);
    }
    console.log("--- ALL REDIS KEYS ---");
    console.log(keys);

    console.log("\nFlushing Redis DB...");
    await redisClient.flushDb();
    console.log("Flushed successfully.");

  } catch (err) {
    console.error("Redis Error:", err);
  } finally {
    process.exit(0);
  }
}

run();
