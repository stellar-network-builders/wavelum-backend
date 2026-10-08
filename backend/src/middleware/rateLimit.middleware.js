const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const IORedis = require('ioredis');
const logger = require('../utils/logger');

const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_IP_MAX = 100;
const DEFAULT_USER_MAX = 100;
const DEFAULT_AUTH_MAX = 10;

const readPositiveInt = (name, fallback) => {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const resolveRateLimitConfig = () => ({
  windowMs: readPositiveInt('RATE_LIMIT_WINDOW_MS', DEFAULT_WINDOW_MS),
  ipMax: readPositiveInt('RATE_LIMIT_IP_MAX', DEFAULT_IP_MAX),
  userMax: readPositiveInt('RATE_LIMIT_USER_MAX', DEFAULT_USER_MAX),
  authMax: readPositiveInt('RATE_LIMIT_AUTH_MAX', DEFAULT_AUTH_MAX),
});

const hashKey = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 32);

const getClientIp = (req) => {
  // Express resolves req.ip using its configured trust-proxy policy. Never
  // fall back to raw X-Forwarded-For; an untrusted caller controls that header.
  return req.ip || req.socket?.remoteAddress ||
    req.connection?.remoteAddress || 'unknown';
};

const getAuthenticatedSubject = (req) => {
  if (req.user?.address) return String(req.user.address).toLowerCase();

  const authHeader = req.headers?.authorization;
  if (!authHeader?.startsWith('Bearer ') || !process.env.JWT_SECRET) {
    return null;
  }

  try {
    const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
    const subject = decoded.address || decoded.sub || decoded.userId;
    return subject ? String(subject).toLowerCase() : null;
  } catch (_error) {
    return null;
  }
};

class SlidingWindowCounter {
  constructor({
    clientProvider = () => null,
    prefix = 'rate-limit',
    now = () => Date.now(),
  } = {}) {
    this.clientProvider = clientProvider;
    this.prefix = prefix;
    this.now = now;
    this.memory = new Map();
  }

  _result(currentCount, previousCount, now, windowMs) {
    const bucketStart = Math.floor(now / windowMs) * windowMs;
    const elapsed = now - bucketStart;
    const previousWeight = Math.max(0, 1 - elapsed / windowMs);
    const totalHits = Math.ceil(
      currentCount + previousCount * previousWeight,
    );

    return {
      totalHits,
      resetTime: now + windowMs,
    };
  }

  _memoryHit(key, now, windowMs) {
    const bucket = Math.floor(now / windowMs);
    const currentKey = `${key}:${bucket}`;
    const previousKey = `${key}:${bucket - 1}`;

    const currentCount = (this.memory.get(currentKey) || 0) + 1;
    this.memory.set(currentKey, currentCount);
    const previousCount = this.memory.get(previousKey) || 0;

    for (const storedKey of this.memory.keys()) {
      const storedBucket = Number.parseInt(
        storedKey.slice(storedKey.lastIndexOf(':') + 1),
        10,
      );
      if (Number.isFinite(storedBucket) && storedBucket < bucket - 1) {
        this.memory.delete(storedKey);
      }
    }

    return this._result(currentCount, previousCount, now, windowMs);
  }

  async _redisHit(client, key, now, windowMs) {
    const bucket = Math.floor(now / windowMs);
    const currentKey = `${this.prefix}:${key}:${bucket}`;
    const previousKey = `${this.prefix}:${key}:${bucket - 1}`;
    const ttlSeconds = Math.ceil((windowMs * 2) / 1000) + 1;

    const results = await client
      .multi()
      .incr(currentKey)
      .expire(currentKey, ttlSeconds)
      .get(previousKey)
      .exec();

    // Redis MULTI can return an error for an individual command while exec()
    // itself resolves successfully. Treating that failed INCR as zero gives
    // callers an unmetered request instead of entering the existing fallback.
    if (!Array.isArray(results) || results.length !== 3 ||
        results.some((reply) => !Array.isArray(reply) || reply[0] != null)) {
      throw new Error('Redis rate-limit transaction failed');
    }
    const currentCount = Number(results[0][1]);
    const previousCount = Number(results[2][1] || 0);
    if (!Number.isSafeInteger(currentCount) || currentCount < 1 ||
        !Number.isSafeInteger(previousCount) || previousCount < 0) {
      throw new Error('Redis rate-limit counter response invalid');
    }
    return this._result(currentCount, previousCount, now, windowMs);
  }

  async hit(key, windowMs) {
    const now = this.now();
    try {
      // Redis client construction or configuration can fail synchronously.
      // Guard provider acquisition as well as the Redis command pipeline so
      // malformed/unavailable Redis cannot turn every API request into a 500.
      const client = this.clientProvider();
      if (client) {
        return await this._redisHit(client, key, now, windowMs);
      }
    } catch (error) {
      logger.warn(
        'Redis rate-limit check failed; using local fallback:',
        error instanceof Error ? error.message : String(error),
      );
    }

    return this._memoryHit(key, now, windowMs);
  }
}

let redisClient;
const getRedisClient = () => {
  if (process.env.NODE_ENV === 'test' || !process.env.REDIS_URL) return null;
  if (redisClient) return redisClient;

  redisClient = new IORedis(process.env.REDIS_URL, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  redisClient.on('error', (error) =>
    logger.error('Rate-limit Redis error:', error.message),
  );
  return redisClient;
};

const sharedCounter = new SlidingWindowCounter({
  clientProvider: getRedisClient,
});
const skipInTest = () => process.env.NODE_ENV === 'test';

const getGlobalIdentity = (req, config) => {
  const subject = getAuthenticatedSubject(req);
  if (subject) {
    return {
      key: `user:${hashKey(subject)}`,
      limit: config.userMax,
      scope: 'user',
    };
  }

  return {
    key: `ip:${hashKey(getClientIp(req))}`,
    limit: config.ipMax,
    scope: 'ip',
  };
};

const getGlobalIdentities = (req, config) => {
  const identities = [
    {
      key: `ip:${hashKey(getClientIp(req))}`,
      limit: config.ipMax,
      scope: 'ip',
    },
  ];
  const subject = getAuthenticatedSubject(req);
  if (subject) {
    identities.push({
      key: `user:${hashKey(subject)}`,
      limit: config.userMax,
      scope: 'user',
    });
  }
  return identities;
};

const getAuthIdentity = (req, config) => {
  const path = String(
    req.originalUrl || req.url || req.path || '/',
  ).split('?')[0];
  const endpoint = `${String(req.method || 'GET').toUpperCase()}:${path}`;
  return {
    key: `auth:${hashKey(`${endpoint}:${getClientIp(req)}`)}`,
    limit: config.authMax,
    scope: 'auth-endpoint',
  };
};

const createRateLimiter = ({
  mode,
  counter = sharedCounter,
  skip = skipInTest,
  configResolver = resolveRateLimitConfig,
} = {}) => {
  if (mode !== 'global' && mode !== 'auth') {
    throw new Error(`Unknown rate-limit mode: ${mode}`);
  }

  return async (req, res, next) => {
    if (skip(req)) return next();

    const config = configResolver();
    const identities =
      mode === 'auth'
        ? [getAuthIdentity(req, config)]
        : getGlobalIdentities(req, config);

    const checks = [];
    for (const identity of identities) {
      const result = await counter.hit(identity.key, config.windowMs);
      checks.push({
        identity,
        result,
        remaining: Math.max(0, identity.limit - result.totalHits),
      });
    }

    const blocked = checks.find(
      ({ identity, result }) => result.totalHits > identity.limit,
    );
    const effective =
      blocked ||
      checks.reduce((mostRestrictive, check) =>
        check.remaining < mostRestrictive.remaining ? check : mostRestrictive,
      );
    const { identity, result, remaining } = effective;
    const resetSeconds = Math.max(
      1,
      Math.ceil((result.resetTime - Date.now()) / 1000),
    );
    const resetEpochSeconds = Math.ceil(result.resetTime / 1000);

    res.set({
      'X-RateLimit-Limit': String(identity.limit),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(resetEpochSeconds),
    });

    if (blocked) {
      res.set('Retry-After', String(resetSeconds));
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message:
          mode === 'auth'
            ? 'Too many authentication attempts. Please try again later.'
            : 'Too many requests. Please try again later.',
        rateLimitInfo: {
          limit: identity.limit,
          remaining: 0,
          resetTime: new Date(result.resetTime).toISOString(),
          retryAfter: resetSeconds,
          scope: identity.scope,
        },
      });
    }

    req.rateLimit = {
      limit: identity.limit,
      remaining,
      resetTime: result.resetTime,
      scope: identity.scope,
    };
    return next();
  };
};

const globalRateLimiter = createRateLimiter({ mode: 'global' });
const authRateLimiter = createRateLimiter({ mode: 'auth' });

module.exports = {
  SlidingWindowCounter,
  resolveRateLimitConfig,
  getGlobalIdentity,
  getGlobalIdentities,
  getAuthIdentity,
  createRateLimiter,
  globalRateLimiter,
  authRateLimiter,
};
