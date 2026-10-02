import { createClient } from "redis";

const redisUrl = process.env.UPSTASH_REDIS_URL || "redis://127.0.0.1:6379";

const redisClient = createClient({
  url: redisUrl,
  socket: {
    tls: redisUrl.startsWith("rediss://"),
    rejectUnauthorized: false,
    connectTimeoutMs: 5000,
    keepAlive: 5000,
    reconnectStrategy: (retries) => {
      // Reconnect with gentle backoff on idle socket closures
      return Math.min(retries * 200, 2000);
    },
  },
});

redisClient.on("error", (err) => {
  const errMsg = err?.message || String(err);
  if (errMsg.includes("Socket closed unexpectedly") || errMsg.includes("ETIMEDOUT")) {
    console.warn("[Upstash Redis] Idle socket closed, reconnecting automatically...");
  } else {
    console.error("Redis Client Error:", errMsg);
  }
});

redisClient.on("connect", () => {
  console.log("Connected to Upstash Redis");
});

// Perform async connection boot
redisClient.connect().catch((err) => {
  console.error("Error connecting to Upstash Redis:", err);
});

export default redisClient;
