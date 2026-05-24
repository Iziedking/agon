import { Redis } from "ioredis";
import { config } from "./config/index.js";

/// Shared Redis connection. `maxRetriesPerRequest: null` keeps it compatible
/// with BullMQ, which the coordinator uses on the same instance.
export const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
