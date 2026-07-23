import redisClient from "../config/redis.js";

// In-Memory L1 Cache for ultra-fast local responses (<1ms)
const memoryCache = new Map();

// Default 24 Hours TTL (86,400,000 ms) for persistent fast tab switching
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// Safe cache retrieval
export const getCache = async (key) => {
  try {
    // 1. Check local Node.js RAM first (0ms latency!)
    const local = memoryCache.get(key);
    if (local && local.expiresAt > Date.now()) {
      return local.data;
    }

    // 2. Fallback to Redis if ready
    if (redisClient.isReady) {
      const data = await redisClient.get(key);
      if (data) {
        const parsed = JSON.parse(data);
        memoryCache.set(key, { data: parsed, expiresAt: Date.now() + DEFAULT_TTL_MS });
        return parsed;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
};

// Safe cache storage with TTL (default 24 hours)
export const setCache = async (key, data, ttlSeconds = 86400) => {
  try {
    const ttlMs = ttlSeconds * 1000;
    // Store in local Node.js RAM (0ms)
    memoryCache.set(key, { data, expiresAt: Date.now() + ttlMs });

    // Store in Redis if ready
    if (redisClient.isReady) {
      const payload = JSON.stringify(data);
      await redisClient.set(key, payload, { EX: ttlSeconds });
    }
  } catch (err) {}
};

// Safe key deletion
export const deleteCache = async (key) => {
  try {
    memoryCache.delete(key);
    if (redisClient.isReady) {
      await redisClient.del(key);
    }
  } catch (err) {}
};

// Scan and delete keys matching a pattern (e.g. "teacher:*")
export const clearCachePattern = async (pattern) => {
  try {
    // Clear all memory cache keys instantly
    memoryCache.clear();

    if (redisClient.isReady) {
      const keysToDelete = [];
      for await (const key of redisClient.scanIterator({ MATCH: pattern, COUNT: 100 })) {
        keysToDelete.push(key);
      }
      if (keysToDelete.length > 0) {
        await Promise.all(keysToDelete.map((k) => redisClient.del(k)));
      }
    }
  } catch (err) {}
};

export const flushMemoryCache = () => {
  memoryCache.clear();
};
