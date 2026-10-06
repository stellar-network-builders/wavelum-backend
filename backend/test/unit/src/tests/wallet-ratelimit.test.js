const { walletRateLimiter } = require('../util/wallet-ratelimit.util');
const { walletRateLimitMiddleware, graphqlWalletRateLimitMiddleware } = require('../middleware/wallet-ratelimit.middleware');

// Mock Redis for testing
const mockRedis = {
  zRemRangeByScore: jest.fn(),
  zCard: jest.fn(),
  zRange: jest.fn(),
  zAdd: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
  connect: jest.fn(),
  on: jest.fn()
};

// Mock the Redis client
jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedis)
}));

describe('Wallet Rate Limiting', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset the rate limiter instance
    walletRateLimiter.redis = null;
  });

  describe('WalletRateLimiter', () => {
    test('should validate wallet address format', () => {
      expect(walletRateLimiter.isValidWalletAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
      expect(walletRateLimiter.isValidWalletAddress('GABC1234567890ABCDEF1234567890ABCDEF123456')).toBe(true);
      expect(walletRateLimiter.isValidWalletAddress('')).toBe(false);
      expect(walletRateLimiter.isValidWalletAddress(null)).toBe(false);
      expect(walletRateLimiter.isValidWalletAddress(undefined)).toBe(false);
      expect(walletRateLimiter.isValidWalletAddress('short')).toBe(false);
      expect(walletRateLimiter.isValidWalletAddress('invalid@address')).toBe(false);
    });

    test('should allow requests within limit', async () => {
      const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';
      
      mockRedis.zRemRangeByScore.mockResolvedValue(0);
      mockRedis.zCard.mockResolvedValue(5); // 5 previous requests
      mockRedis.zAdd.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const result = await walletRateLimiter.checkRateLimit(walletAddress);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(94); // 100 - 5 - 1
      expect(result.total).toBe(100);
      expect(mockRedis.zAdd).toHaveBeenCalled();
    });

    test('should deny requests exceeding limit', async () => {
      const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';
      
      mockRedis.zRemRangeByScore.mockResolvedValue(0);
      mockRedis.zCard.mockResolvedValue(100); // Already at limit
      mockRedis.zRange.mockResolvedValue([`${Date.now() - 30000}-123`]); // 30 seconds ago

      const result = await walletRateLimiter.checkRateLimit(walletAddress);

      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.total).toBe(100);
      expect(mockRedis.zAdd).not.toHaveBeenCalled();
    });

    test('should handle Redis errors gracefully', async () => {
      const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';
      
      mockRedis.zRemRangeByScore.mockRejectedValue(new Error('Redis connection failed'));

      const result = await walletRateLimiter.checkRateLimit(walletAddress);

      // Should fail open - allow request if Redis is down
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(100);
    });

    test('should reset rate limit for wallet', async () => {
      const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';
      
      mockRedis.del.mockResolvedValue(1);

      await expect(walletRateLimiter.resetRateLimit(walletAddress)).resolves.not.toThrow();
      expect(mockRedis.del).toHaveBeenCalledWith('rate_limit:wallet:0x1234567890abcdef1234567890abcdef12345678');
    });

    test('should get current rate limit status', async () => {
      const walletAddress = '0x1234567890abcdef1234567890abcdef12345678';
      
      mockRedis.zRemRangeByScore.mockResolvedValue(0);
      mockRedis.zCard.mockResolvedValue(25);
      mockRedis.zRange.mockResolvedValue([`${Date.now() - 30000}-123`]);

      const result = await walletRateLimiter.getRateLimitStatus(walletAddress);

      expect(result.current).toBe(25);
      expect(result.remaining).toBe(75);
      expect(result.total).toBe(100);
    });
  });

  describe('Express Middleware', () => {
    let req, res, next;

    beforeEach(() => {
      req = {
        headers: {}
      };
      res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        set: jest.fn()
      };
      next = jest.fn();
    });

    test('should skip middleware if no wallet address header', async () => {
      await walletRateLimitMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    test('should allow requests within limit', async () => {
      req.headers['x-wallet-address'] = '0x1234567890abcdef1234567890abcdef12345678';
      
      mockRedis.zRemRangeByScore.mockResolvedValue(0);
      mockRedis.zCard.mockResolvedValue(5);
      mockRedis.zAdd.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      await walletRateLimitMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.set).toHaveBeenCalledWith(expect.objectContaining({
        'X-RateLimit-Limit': 100,
        'X-RateLimit-Remaining': 94
      }));
      expect(req.rateLimit).toBeDefined();
    });

    test('should block requests exceeding limit', async () => {
      req.headers['x-wallet-address'] = '0x1234567890abcdef1234567890abcdef12345678';
      
      mockRedis.zRemRangeByScore.mockResolvedValue(0);
      mockRedis.zCard.mockResolvedValue(100);
      mockRedis.zRange.mockResolvedValue([`${Date.now() - 30000}-123`]);

      await walletRateLimitMiddleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this wallet. Please try again later.'
      }));
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('GraphQL Middleware', () => {
    let mockResolve, mockParent, mockArgs, mockContext, mockInfo;

    beforeEach(() => {
      mockResolve = jest.fn();
      mockParent = {};
      mockArgs = {};
      mockContext = {
        req: {
          headers: {}
        }
      };
      mockInfo = {
        fieldName: 'testQuery',
        operation: { operation: 'query' }
      };
    });

    test('should skip middleware if no wallet address header', async () => {
      const middleware = graphqlWalletRateLimitMiddleware();
      
      await middleware(mockResolve, mockParent, mockArgs, mockContext, mockInfo);

      expect(mockResolve).toHaveBeenCalledWith(mockParent, mockArgs, mockContext, mockInfo);
    });

    test('should allow requests within limit', async () => {
      mockContext.req.headers['x-wallet-address'] = '0x1234567890abcdef1234567890abcdef12345678';
      
      mockRedis.zRemRangeByScore.mockResolvedValue(0);
      mockRedis.zCard.mockResolvedValue(5);
      mockRedis.zAdd.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const middleware = graphqlWalletRateLimitMiddleware();
      
      await middleware(mockResolve, mockParent, mockArgs, mockContext, mockInfo);

      expect(mockResolve).toHaveBeenCalledWith(mockParent, mockArgs, mockContext, mockInfo);
      expect(mockContext.walletRateLimit).toBeDefined();
    });

    test('should throw error for requests exceeding limit', async () => {
      mockContext.req.headers['x-wallet-address'] = '0x1234567890abcdef1234567890abcdef12345678';
      
      mockRedis.zRemRangeByScore.mockResolvedValue(0);
      mockRedis.zCard.mockResolvedValue(100);
      mockRedis.zRange.mockResolvedValue([`${Date.now() - 30000}-123`]);

      const middleware = graphqlWalletRateLimitMiddleware();
      
      await expect(middleware(mockResolve, mockParent, mockArgs, mockContext, mockInfo))
        .rejects.toThrow('Too many requests from this wallet. Please try again later.');
      
      expect(mockResolve).not.toHaveBeenCalled();
    });
  });
});
