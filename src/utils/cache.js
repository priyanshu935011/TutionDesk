import redisClient from "../config/redis.js";

// Safe cache retrieval
export const getCache = async (key) => {
  try {
    if (!redisClient.isReady) return null;
    const data = await redisClient.get(key);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error(`Cache Read Error (key: ${key}):`, err);
    return null;
  }
};

// Safe cache storage with TTL
export const setCache = async (key, data, ttlSeconds = 3600) => {
  try {
    if (!redisClient.isReady) return;
    const payload = JSON.stringify(data);
    await redisClient.set(key, payload, {
      EX: ttlSeconds,
    });
  } catch (err) {
    console.error(`Cache Write Error (key: ${key}):`, err);
  }
};

// Safe key deletion
export const deleteCache = async (key) => {
  try {
    if (!redisClient.isReady) return;
    await redisClient.del(key);
  } catch (err) {
    console.error(`Cache Delete Error (key: ${key}):`, err);
  }
};

// Scan and delete keys matching a pattern (e.g. "student:dashboard:*")
export const clearCachePattern = async (pattern) => {
  try {
    if (!redisClient.isReady) return;
    const keysToDelete = [];

    for await (const key of redisClient.scanIterator({
      MATCH: pattern,
      COUNT: 100,
    })) {
      keysToDelete.push(key);
    }

    if (keysToDelete.length > 0) {
      await Promise.all(keysToDelete.map((k) => redisClient.del(k)));
      console.log(`Cache cleared for keys matching "${pattern}". Evicted ${keysToDelete.length} keys.`);
    }
  } catch (err) {
    console.error(`Cache Pattern Eviction Error (pattern: ${pattern}):`, err);
  }
};
