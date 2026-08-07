import "dotenv/config";
import redisClient from "../config/redis.js";
import { clearCachePattern } from "../utils/cache.js";

async function run() {
  try {
    console.log("Connecting to Redis...");
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    console.log("Connected.");

    const ownerId = "47d3edee-b327-48ed-8f1c-1ac35f08c976"; // Tiwari & son's Academy
    
    // Clear Redis cache keys matching the pattern
    const pattern = `teacher:students:${ownerId}:*`;
    console.log(`Clearing cache pattern: ${pattern}`);
    
    await clearCachePattern(pattern);
    console.log("Cache cleared successfully.");

  } catch (err) {
    console.error("Error clearing cache:", err);
  } finally {
    process.exit(0);
  }
}

run();
