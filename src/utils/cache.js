import redisClient from "../config/redis.js";

// In-Memory L1 Cache for ultra-fast local responses (<1ms)
const memoryCache = new Map();
const MAX_MEMORY_CACHE_SIZE = 500;

// Default 2 Hours TTL (7,200,000 ms) to keep RAM lean
const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000;

// Helper to bound memory cache size
const setMemoryCacheItem = (key, value) => {
  if (memoryCache.size >= MAX_MEMORY_CACHE_SIZE && !memoryCache.has(key)) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey !== undefined) {
      memoryCache.delete(firstKey);
    }
  }
  memoryCache.set(key, value);
};

// Safe cache retrieval
export const getCache = async (key) => {
  try {
    // 1. Check local Node.js RAM first (0ms latency!)
    const local = memoryCache.get(key);
    if (local && local.expiresAt > Date.now()) {
      return local.data;
    }
    if (local) {
      memoryCache.delete(key);
    }

    // 2. Fallback to Redis if ready
    if (redisClient.isReady) {
      const data = await redisClient.get(key);
      if (data) {
        const parsed = JSON.parse(data);
        setMemoryCacheItem(key, { data: parsed, expiresAt: Date.now() + DEFAULT_TTL_MS });
        return parsed;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
};

// Safe cache storage with TTL (default 2 hours)
export const setCache = async (key, data, ttlSeconds = 7200) => {
  try {
    const ttlMs = ttlSeconds * 1000;
    // Store in local Node.js RAM with bounded size
    setMemoryCacheItem(key, { data, expiresAt: Date.now() + ttlMs });

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
    if (!pattern || pattern === "*") {
      memoryCache.clear();
    } else {
      const regexPattern = new RegExp("^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
      for (const key of memoryCache.keys()) {
        if (regexPattern.test(key)) {
          memoryCache.delete(key);
        }
      }
    }

    if (redisClient.isReady) {
      try {
        const keysToDelete = [];
        for await (const key of redisClient.scanIterator({ MATCH: pattern, COUNT: 100 })) {
          keysToDelete.push(key);
        }
        if (keysToDelete.length > 0) {
          await redisClient.del(keysToDelete);
        }
      } catch (scanErr) {
        try {
          const keys = await redisClient.keys(pattern);
          if (keys && keys.length > 0) {
            await redisClient.del(keys);
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error("clearCachePattern error:", err);
  }
};

export const flushMemoryCache = () => {
  memoryCache.clear();
};
