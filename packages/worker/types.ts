import * as redis from "redis";

export type RedisClient = ReturnType<typeof redis.createClient>;
