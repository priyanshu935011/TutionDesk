import { rateLimit } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import redisClient from "../config/redis.js";

// Global limits: 200 requests per 1 minute
const globalMemoryLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many requests from this IP, please try again after a minute",
  },
});

const globalRedisLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }),
  message: {
    message: "Too many requests from this IP, please try again after a minute",
  },
});

export const globalLimiter = (req, res, next) => {
  if (redisClient.isReady) {
    return globalRedisLimiter(req, res, next);
  }
  return globalMemoryLimiter(req, res, next);
};

// Auth limits: 20 requests per 15 minutes
const authMemoryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    message: "Too many authentication attempts from this IP, please try again after 15 minutes",
  },
});

const authRedisLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }),
  message: {
    message: "Too many authentication attempts from this IP, please try again after 15 minutes",
  },
});

export const authLimiter = (req, res, next) => {
  if (redisClient.isReady) {
    return authRedisLimiter(req, res, next);
  }
  return authMemoryLimiter(req, res, next);
};
