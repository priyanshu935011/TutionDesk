import { createClient } from "redis";

const redisUrl = process.env.UPSTASH_REDIS_URL || "redis://127.0.0.1:6379";

const redisClient = createClient({
  url: redisUrl,
  socket: {
    tls: redisUrl.startsWith("rediss://"),
    rejectUnauthorized: false,
    connectTimeoutMs: 2000,
    reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
  },
});

redisClient.on("error", (err) => {
  console.error("Redis Client Error:", err);
});

redisClient.on("connect", () => {
  console.log("Connected to Upstash Redis");
});

// Perform async connection boot
redisClient.connect().catch((err) => {
  console.error("Error connecting to Upstash Redis:", err);
});

export default redisClient;
