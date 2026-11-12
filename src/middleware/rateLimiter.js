import { rateLimit } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import redisClient from "../config/redis.js";

/**
 * Builds a Redis-backed limiter with an in-memory fallback when Redis is unavailable.
 */
const createDualLimiter = ({ windowMs, max, message, prefix }) => {
  const baseOptions = {
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: false,
    skip: (req) => req.method === "OPTIONS",
    message: { message },
  };

  const memoryLimiter = rateLimit(baseOptions);
  const redisLimiter = rateLimit({
    ...baseOptions,
    store: new RedisStore({
      prefix,
      sendCommand: (...args) => redisClient.sendCommand(args),
    }),
  });

  return (req, res, next) =>
    redisClient.isReady ? redisLimiter(req, res, next) : memoryLimiter(req, res, next);
};

// Global limits: 200 requests per 1 minute
export const globalLimiter = createDualLimiter({
  windowMs: 1 * 60 * 1000,
  max: 200,
  prefix: "rl:global:",
  message: "Too many requests from this IP, please try again after a minute",
});

// Auth limits: 20 requests per 15 minutes
export const authLimiter = createDualLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  prefix: "rl:auth:",
  message: "Too many authentication attempts from this IP, please try again after 15 minutes",
});

// Public contact form limits: 5 submissions per 15 minutes per IP
export const contactLimiter = createDualLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  prefix: "rl:contact:",
  message: "Too many contact inquiries sent from this IP. Please wait 15 minutes before trying again.",
});
