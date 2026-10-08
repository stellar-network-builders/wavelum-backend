const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// Only the framework's connection-derived IP may select an ingress bucket.
// Arbitrary x-user-address and Bearer bytes are NOT authenticated principals.
// ipKeyGenerator also groups IPv6 addresses by subnet to prevent prefix rotation.
const trustedIpKey = (req) => {
  const ip = req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress;
  return `ip:${ip ? ipKeyGenerator(ip) : 'unknown'}`;
};

const requestCounts = new Map();

const RATE_LIMIT_CONFIGS = {
  unauthenticated: {
    windowMs: 15 * 60 * 1000,
    max: 50,
    message: 'Too many requests from unauthenticated users. Please authenticate to increase limits.'
  },
  user: {
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: 'Rate limit exceeded for user. Please try again later.'
  },
  admin: {
    windowMs: 15 * 60 * 1000,
    max: 1000,
    message: 'Rate limit exceeded for admin. Please try again later.'
  }
};

const graphqlRateLimitMiddleware = (options = {}) => {
  return async (resolve, parent, args, context, info) => {
    const user = context.user;
    const req = context.req;
    if (!req) return resolve(parent, args, context, info);

    // GraphQL's resolver-level limiter also distinguishes verified user context,
    // but never derives identity or client IP from user-controlled headers.
    const userAddress = user?.address || 'anonymous';
    const identifier = `${trustedIpKey(req)}:${userAddress}`;

    let config = !user ? RATE_LIMIT_CONFIGS.unauthenticated : (user.role === 'admin' ? RATE_LIMIT_CONFIGS.admin : RATE_LIMIT_CONFIGS.user);
    const windowMs = options.windowMs || config.windowMs;
    const maxRequests = options.max || config.max;
    const message = options.message || config.message;

    const now = Date.now();
    const current = requestCounts.get(identifier);

    if (!current || now > current.resetTime) {
      requestCounts.set(identifier, { count: 1, resetTime: now + windowMs });
    } else {
      current.count++;
      if (current.count > maxRequests) {
        const error = new Error(message);
        error.extensions = {
          code: 'RATE_LIMIT_EXCEEDED',
          rateLimitInfo: { limit: maxRequests, current: current.count, resetTime: new Date(current.resetTime).toISOString(), windowMs }
        };
        throw error;
      }
    }

    if (Math.random() < 0.01) {
      for (const [key, value] of requestCounts.entries()) {
        if (now > value.resetTime) requestCounts.delete(key);
      }
    }

    return resolve(parent, args, context, info);
  };
};

const operationRateLimit = {
  strict: graphqlRateLimitMiddleware({ windowMs: 15 * 60 * 1000, max: 10, message: 'Rate limit exceeded for this operation. Please try again later.' }),
  moderate: graphqlRateLimitMiddleware({ windowMs: 15 * 60 * 1000, max: 100, message: 'Rate limit exceeded for this operation. Please try again later.' }),
  lenient: graphqlRateLimitMiddleware({ windowMs: 15 * 60 * 1000, max: 500, message: 'Rate limit exceeded for this operation. Please try again later.' })
};

const createRateLimiter = (options = {}) => {
  return rateLimit({
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: options.max || 100,
    message: options.message || 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    skipFailedRequests: options.skipFailedRequests || false,
    // Keep the IP ceiling even for authenticated requests; selecting a
    // different caller-provided address or token cannot mint a new bucket.
    keyGenerator: trustedIpKey,
    handler: (req, res) => {
      res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: options.message || 'Too many requests, please try again later.',
        rateLimitInfo: {
          limit: options.max || 100,
          windowMs: options.windowMs || 15 * 60 * 1000,
          userType: req.user?.address ? 'authenticated' : 'anonymous',
          retryAfter: Math.ceil((options.windowMs || 15 * 60 * 1000) / 1000)
        }
      });
    }
  });
};

const getRateLimitForOperation = (operationName, operationType) => {
  const expensiveOperations = ['processBatchClaims', 'backfillMissingPrices', 'createVault', 'topUpVault'];
  const moderateOperations = ['withdraw', 'processClaim', 'transferVault', 'revokeAccess'];
  if (operationType === 'query') return operationRateLimit.lenient;
  if (expensiveOperations.includes(operationName)) return operationRateLimit.strict;
  if (moderateOperations.includes(operationName)) return operationRateLimit.moderate;
  return operationRateLimit.moderate;
};

const adaptiveRateLimitMiddleware = async (resolve, parent, args, context, info) => {
  const operationName = info.fieldName;
  const operationType = info.operation.operation;
  const rateLimitMiddleware = getRateLimitForOperation(operationName, operationType);
  return rateLimitMiddleware(resolve, parent, args, context, info);
};

module.exports = {
  graphqlRateLimitMiddleware,
  trustedIpKey,
  operationRateLimit,
  rateLimiter: createRateLimiter,
  getRateLimitForOperation,
  adaptiveRateLimitMiddleware
};
