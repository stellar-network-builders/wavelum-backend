const logger = require('../utils/logger');
const redis = require('redis');
const secretsService = require('./secretsService');
const metricsService = require('./metricsService');

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.defaultTTL = 3600; // 1 hour in seconds
    this.TTL = Object.freeze({
      VAULT: 300,        // 5 minutes
      SUB_SCHEDULE: 120, // 2 minutes
      CLAIMS: 30,        // 30 seconds
    });
    this.inFlightLocks = new Map();
    this.memoryCache = new Map();
  }

  _extractKeyPrefix(key) {
    if (!key || typeof key !== 'string') return 'unknown';
    const parts = key.split(':');
    if (parts.length >= 2) {
      return `${parts[0]}:${parts[1]}`;
    }
    return parts[0];
  }

  getVaultKey(id) {
    return `vesting:vault:${id}`;
  }

  getSubScheduleKey(id) {
    return `vesting:sub_schedule:${id}`;
  }

  getClaimsKey(subScheduleId) {
    return `vesting:claims:${subScheduleId}`;
  }

  getScheduleKey(vaultAddress, beneficiaryAddress = null) {
    return `vesting:vault:${vaultAddress}:schedule:${beneficiaryAddress || 'all'}`;
  }

  /**
   * Initialize Redis connection with TLS and authentication
   */
  async connect() {
    try {
      let redisHost, redisPort, redisPassword, useTls;
      
      // Get Redis credentials dynamically from secrets service
      try {
        const redisConfig = await secretsService.getRedisCredentials();
        redisHost = redisConfig.host;
        redisPort = redisConfig.port;
        redisPassword = redisConfig.password;
        useTls = redisConfig.tls;
        
        logger.info('Redis cache connection initialized with dynamic credentials');
      } catch (error) {
        logger.error('Failed to initialize Redis cache with dynamic credentials, falling back to environment variables:', error);
        
        // Fallback to environment variables if secrets service fails
        redisHost = process.env.REDIS_HOST || "localhost";
        redisPort = process.env.REDIS_PORT || 6379;
        redisPassword = process.env.REDIS_PASSWORD;
        useTls = process.env.REDIS_TLS === 'true' || process.env.NODE_ENV === 'production';
      }
      
      // Enforce TLS in production environments
      if (process.env.NODE_ENV === 'production' && !useTls) {
        throw new Error('Redis TLS is required in production. Set REDIS_TLS=true or use rediss:// URL.');
      }
      
      // Enforce password authentication in production
      if (process.env.NODE_ENV === 'production' && !redisPassword) {
        throw new Error('Redis password authentication is required in production. Set REDIS_PASSWORD.');
      }
      
      const redisUrl = process.env.REDIS_URL || 
        (useTls ? `rediss://${redisHost}:${redisPort}` : `redis://${redisHost}:${redisPort}`);
      
      this.client = redis.createClient({
        url: redisUrl,
        password: redisPassword,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.error('Redis max reconnection attempts reached');
              return new Error('Max reconnection attempts reached');
            }
            return Math.min(retries * 100, 3000);
          },
          // TLS configuration for secure connections
          tls: useTls,
          rejectUnauthorized: true, // Enforce certificate verification
          minVersion: 'TLSv1.2', // Require minimum TLS version 1.2
          maxVersion: 'TLSv1.3'  // Allow up to TLS 1.3
        },
        // Connection security settings
        connectTimeout: 10000,
        lazyConnect: true,
        // Authentication timeout
        commandTimeout: 5000,
      });

      this.client.on('error', (err) => {
        logger.error('Redis Client Error:', err);
        this.isConnected = false;
        // Log TLS-specific errors for debugging
        if (err.message.includes('TLS') || err.message.includes('certificate')) {
          logger.error("Redis TLS Error - Check certificate configuration and REDIS_TLS setting");
        }
      });

      this.client.on('connect', () => {
        logger.info(`Redis client connected (TLS: ${useTls ? 'enabled' : 'disabled'})`);
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        logger.info("Redis client ready - Authentication successful");
      });

      this.client.on('disconnect', () => {
        logger.info('Redis client disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
      return true;
    } catch (error) {
      logger.error('Failed to connect to Redis:', error);
      this.isConnected = false;
      return false;
    }
  }

  /**
   * Generate cache key for user vaults
   * @param {string} address - User address
   * @returns {string} Cache key
   */
  getUserVaultsKey(address) {
    return `user_vaults_${address}`;
  }

  /**
   * Generate cache key for user portfolio
   * @param {string} address - User address
   * @returns {string} Cache key
   */
  getUserPortfolioKey(address) {
    return `user_portfolio:${address}`;
  }

  /**
   * Get value from cache
   * @param {string} key - Cache key
   * @returns {Promise<any>} Cached value or null
   */
  async get(key) {
    try {
      if (!this.isConnected || !this.client) {
        return null;
      }

      const value = await this.client.get(key);
      if (value) {
        return JSON.parse(value);
      }
      return null;
    } catch (error) {
      logger.error(`Error getting cache key ${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttl - Time to live in seconds (optional)
   * @returns {Promise<boolean>} Success status
   */
  async set(key, value, ttl = this.defaultTTL) {
    try {
      if (!this.isConnected || !this.client) {
        return false;
      }

      const serializedValue = JSON.stringify(value);
      const effectiveTtl = typeof ttl === 'number' && ttl > 0 ? ttl : this.defaultTTL;
      await this.client.setEx(key, effectiveTtl, serializedValue);
      return true;
    } catch (error) {
      logger.error(`Error setting cache key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete value from cache
   * @param {string} key - Cache key
   * @returns {Promise<boolean>} Success status
   */
  async del(key) {
    try {
      if (!this.isConnected || !this.client) {
        return false;
      }

      await this.client.del(key);
      return true;
    } catch (error) {
      logger.error(`Error deleting cache key ${key}:`, error);
      return false;
    }
  }

  /**
   * Delete multiple keys matching a pattern
   * @param {string} pattern - Key pattern (e.g., "vesting:vault:*")
   * @returns {Promise<boolean>} Success status
   */
  async deletePattern(pattern) {
    const startTime = process.hrtime.bigint();
    const keyPrefix = this._extractKeyPrefix(pattern);
    try {
      if (!this.isConnected || !this.client) {
        return false;
      }

      const keys = await this.client.keys(pattern);
      if (keys && keys.length > 0) {
        await this.client.del(keys);
      }

      if (metricsService.cacheOperationsTotal) {
        metricsService.cacheOperationsTotal.inc({
          operation: 'invalidatePattern',
          result: 'success',
          key_prefix: keyPrefix,
        });
      }
      return true;
    } catch (error) {
      logger.error(`Error deleting cache pattern ${pattern}:`, error);
      return false;
    } finally {
      if (metricsService.cacheOperationDuration) {
        const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
        metricsService.cacheOperationDuration.observe(
          { operation: 'invalidatePattern', key_prefix: keyPrefix },
          durationSec
        );
      }
    }
  }

  /**
   * Alias for deletePattern matching the cache-aside specification (#13).
   * @param {string} pattern - Key pattern (e.g. "vesting:vault:*")
   * @returns {Promise<boolean>}
   */
  async invalidatePattern(pattern) {
    return await this.deletePattern(pattern);
  }

  /**
   * Cache-aside helper with singleflight / atomic lock protection to prevent thundering herd (#13).
   * @param {string} key - Cache key
   * @param {number|Function} ttlOrFetchFn - TTL in seconds (or fetchFn if 2-arg form used)
   * @param {Function} [maybeFetchFn] - Async loader function on cache miss
   * @returns {Promise<any>}
   */
  async getOrSet(key, ttlOrFetchFn, maybeFetchFn) {
    const ttl = typeof ttlOrFetchFn === 'number' ? ttlOrFetchFn : this.defaultTTL;
    const fetchFn = typeof ttlOrFetchFn === 'function' ? ttlOrFetchFn : maybeFetchFn;
    const keyPrefix = this._extractKeyPrefix(key);
    const startTime = process.hrtime.bigint();

    try {
      const cached = await this.get(key);
      if (cached !== null) {
        if (metricsService.cacheOperationsTotal) {
          metricsService.cacheOperationsTotal.inc({
            operation: 'getOrSet',
            result: 'hit',
            key_prefix: keyPrefix,
          });
        }
        return cached;
      }

      if (metricsService.cacheOperationsTotal) {
        metricsService.cacheOperationsTotal.inc({
          operation: 'getOrSet',
          result: 'miss',
          key_prefix: keyPrefix,
        });
      }

      if (this.inFlightLocks.has(key)) {
        return await this.inFlightLocks.get(key);
      }

      const loadPromise = (async () => {
        try {
          const fresh = await fetchFn();
          if (fresh !== null && fresh !== undefined) {
            await this.set(key, fresh, ttl);
          }
          return fresh;
        } finally {
          this.inFlightLocks.delete(key);
        }
      })();

      this.inFlightLocks.set(key, loadPromise);
      return await loadPromise;
    } finally {
      if (metricsService.cacheOperationDuration) {
        const durationSec = Number(process.hrtime.bigint() - startTime) / 1e9;
        metricsService.cacheOperationDuration.observe(
          { operation: 'getOrSet', key_prefix: keyPrefix },
          durationSec
        );
      }
    }
  }

  /**
   * Background cache warming for high-traffic keys (#13).
   * @param {Array<string|{key: string, ttl?: number}>} keys - Keys to warm
   * @param {Function} fetchFn - Async loader receiving (key)
   * @param {number} [defaultTtl] - Default TTL in seconds
   * @returns {Promise<Array<{key: string, status: string}>>}
   */
  async warm(keys, fetchFn, defaultTtl = this.TTL.VAULT) {
    if (!Array.isArray(keys) || typeof fetchFn !== 'function') {
      return [];
    }

    const results = await Promise.all(
      keys.map(async (entry) => {
        const key = typeof entry === 'string' ? entry : entry.key;
        const ttl = (typeof entry === 'object' && entry.ttl) || defaultTtl;
        const keyPrefix = this._extractKeyPrefix(key);
        try {
          await this.getOrSet(key, ttl, () => fetchFn(key));
          if (metricsService.cacheOperationsTotal) {
            metricsService.cacheOperationsTotal.inc({
              operation: 'warm',
              result: 'success',
              key_prefix: keyPrefix,
            });
          }
          return { key, status: 'warmed' };
        } catch (error) {
          logger.error(`Error warming cache key ${key}:`, error);
          return { key, status: 'failed' };
        }
      })
    );

    return results;
  }

  /**
   * Wrap an async function with caching
   * @param {string} key - Cache key
   * @param {Function} fn - Async function to wrap
   * @param {number} ttl - TTL in seconds
   * @returns {Promise<any>} Result from cache or function
   */
  async wrapWithCache(key, fn, ttl = this.defaultTTL) {
    return await this.getOrSet(key, ttl, fn);
  }

  /**
   * Invalidate user vaults cache for a specific address
   * @param {string} address - User address
   * @returns {Promise<boolean>} Success status
   */
  async invalidateUserVaults(address) {
    const key = this.getUserVaultsKey(address);
    return await this.del(key);
  }

  /**
   * Invalidate user portfolio cache for a specific address
   * @param {string} address - User address
   * @returns {Promise<boolean>} Success status
   */
  async invalidateUserPortfolio(address) {
    const key = this.getUserPortfolioKey(address);
    return await this.del(key);
  }

  /**
   * Invalidate all user vaults cache
   * @returns {Promise<boolean>} Success status
   */
  async invalidateAllUserVaults() {
    return await this.deletePattern('user_vaults_*');
  }

  /**
   * Check if cache is connected
   * @returns {boolean} Connection status
   */
  isReady() {
    return this.isConnected && this.client !== null;
  }

  /**
   * Disconnect from Redis
   */
  async disconnect() {
    try {
      if (this.client) {
        await this.client.quit();
        this.isConnected = false;
        logger.info('Redis client disconnected');
      }
    } catch (error) {
      logger.error('Error disconnecting from Redis:', error);
    }
  }
}

module.exports = new CacheService();
