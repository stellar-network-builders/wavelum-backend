'use strict';

process.env.NODE_ENV = 'test';

/**
 * cacheService.test.js — Integration & unit tests for Redis cache-aside pattern
 * with TTL-based invalidation, thundering-herd singleflight protection, cache warming,
 * and Prometheus metrics (Issue #13).
 */

const cacheService = require('../src/services/cacheService');
const VaultService = require('../src/services/vaultService');
const vestingService = require('../src/services/vestingService');
const metricsService = require('../src/services/metricsService');
const { Vault, SubSchedule, ClaimsHistory } = require('../src/models');

function createMockRedisClient() {
  const store = new Map();

  return {
    store,
    get: jest.fn(async (key) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    setEx: jest.fn(async (key, ttl, value) => {
      store.set(key, {
        value,
        ttl,
        expiresAt: Date.now() + ttl * 1000,
      });
      return 'OK';
    }),
    del: jest.fn(async (keyOrKeys) => {
      const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
      let deleted = 0;
      for (const k of keys) {
        if (store.delete(k)) deleted++;
      }
      return deleted;
    }),
    keys: jest.fn(async (pattern) => {
      const regexStr =
        '^' +
        String(pattern)
          .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
          .replace(/\*/g, '.*') +
        '$';
      const regex = new RegExp(regexStr);
      return Array.from(store.keys()).filter((k) => regex.test(k));
    }),
    quit: jest.fn(async () => 'OK'),
  };
}

describe('CacheService — Redis Cache-Aside Pattern (Issue #13)', () => {
  let mockClient;

  beforeEach(() => {
    mockClient = createMockRedisClient();
    cacheService.client = mockClient;
    cacheService.isConnected = true;
    cacheService.inFlightLocks.clear();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    cacheService.client = null;
    cacheService.isConnected = false;
    cacheService.inFlightLocks.clear();
  });

  test('follows cache key naming convention and TTL strategy constants', () => {
    expect(cacheService.getVaultKey(42)).toBe('vesting:vault:42');
    expect(cacheService.getSubScheduleKey(99)).toBe('vesting:sub_schedule:99');
    expect(cacheService.getClaimsKey(7)).toBe('vesting:claims:7');
    expect(cacheService.TTL.VAULT).toBe(300);
    expect(cacheService.TTL.SUB_SCHEDULE).toBe(120);
    expect(cacheService.TTL.CLAIMS).toBe(30);
  });

  test('returns fresh data on first miss and cached data within TTL without re-fetching', async () => {
    let dbCallCount = 0;
    const fetchFn = jest.fn(async () => {
      dbCallCount += 1;
      return { id: 'v-101', address: '0xvault101', total_amount: '5000', call: dbCallCount };
    });

    const key = cacheService.getVaultKey('v-101');

    // 1. First request -> cache miss -> fetches fresh data and sets 300s TTL
    const first = await cacheService.getOrSet(key, cacheService.TTL.VAULT, fetchFn);
    expect(first).toEqual({ id: 'v-101', address: '0xvault101', total_amount: '5000', call: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(mockClient.setEx).toHaveBeenCalledWith(
      'vesting:vault:v-101',
      300,
      JSON.stringify(first)
    );

    // 2. Second request within TTL -> cache hit -> returns cached value without invoking fetchFn
    const second = await cacheService.getOrSet(key, cacheService.TTL.VAULT, fetchFn);
    expect(second).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('re-fetches fresh data after TTL expiration', async () => {
    let version = 0;
    const fetchFn = jest.fn(async () => {
      version += 1;
      return { subScheduleId: 12, claimsCount: version };
    });

    const key = cacheService.getClaimsKey(12);
    const first = await cacheService.getOrSet(key, cacheService.TTL.CLAIMS, fetchFn);
    expect(first.claimsCount).toBe(1);

    // Simulate TTL expiry in Redis store
    const entry = mockClient.store.get(key);
    entry.expiresAt = Date.now() - 10;

    const afterExpiry = await cacheService.getOrSet(key, cacheService.TTL.CLAIMS, fetchFn);
    expect(afterExpiry.claimsCount).toBe(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  test('prevents thundering herd under concurrent load using singleflight lock', async () => {
    let fetchCalls = 0;
    const slowFetch = jest.fn(
      () =>
        new Promise((resolve) => {
          fetchCalls += 1;
          setTimeout(() => {
            resolve({ id: 'hot-vault', schedules: [1, 2, 3], fetchCalls });
          }, 40);
        })
    );

    const key = cacheService.getVaultKey('hot-vault');

    // Fire 25 concurrent requests for the same uncached key
    const concurrentRequests = Array.from({ length: 25 }, () =>
      cacheService.getOrSet(key, cacheService.TTL.VAULT, slowFetch)
    );

    const results = await Promise.all(concurrentRequests);
    expect(slowFetch).toHaveBeenCalledTimes(1);
    expect(fetchCalls).toBe(1);
    for (const res of results) {
      expect(res).toEqual({ id: 'hot-vault', schedules: [1, 2, 3], fetchCalls: 1 });
    }
  });

  test('invalidatePattern removes matching prefix keys and preserves unrelated keys', async () => {
    await cacheService.set('vesting:vault:1', { id: 1 }, 300);
    await cacheService.set('vesting:vault:1:schedule:all', { id: 1 }, 300);
    await cacheService.set('vesting:sub_schedule:1', [{ id: 10 }], 120);
    await cacheService.set('vesting:vault:2', { id: 2 }, 300);

    await cacheService.invalidatePattern('vesting:vault:1*');

    expect(await cacheService.get('vesting:vault:1')).toBeNull();
    expect(await cacheService.get('vesting:vault:1:schedule:all')).toBeNull();
    expect(await cacheService.get('vesting:sub_schedule:1')).toEqual([{ id: 10 }]);
    expect(await cacheService.get('vesting:vault:2')).toEqual({ id: 2 });
  });

  test('warm() pre-populates high-traffic keys in background', async () => {
    const keys = [
      { key: cacheService.getVaultKey('v1'), ttl: cacheService.TTL.VAULT },
      { key: cacheService.getVaultKey('v2'), ttl: cacheService.TTL.VAULT },
    ];
    const loader = jest.fn(async (key) => ({ key, warmed: true }));

    const warmResult = await cacheService.warm(keys, loader);
    expect(warmResult).toEqual([
      { key: 'vesting:vault:v1', status: 'warmed' },
      { key: 'vesting:vault:v2', status: 'warmed' },
    ]);
    expect(loader).toHaveBeenCalledTimes(2);

    // Subsequent getOrSet should hit cache without calling new fetchFn
    const fallbackFn = jest.fn();
    const cachedV1 = await cacheService.getOrSet('vesting:vault:v1', 300, fallbackFn);
    expect(cachedV1).toEqual({ key: 'vesting:vault:v1', warmed: true });
    expect(fallbackFn).not.toHaveBeenCalled();
  });

  test('VaultService read queries and write invalidation hooks work end-to-end', async () => {
    const vaultService = new VaultService('https://soroban-testnet.stellar.org');

    jest.spyOn(Vault, 'findByPk').mockResolvedValue({
      id: 77,
      address: '0xvault77',
      total_amount: '1000',
      update: jest.fn().mockResolvedValue({ id: 77, address: '0xvault77', total_amount: '2000' }),
      toJSON: () => ({ id: 77, address: '0xvault77', total_amount: '1000' }),
    });
    jest.spyOn(SubSchedule, 'findAll').mockResolvedValue([
      { id: 501, vault_id: 77, toJSON: () => ({ id: 501, vault_id: 77 }) },
    ]);
    jest.spyOn(ClaimsHistory, 'findAll').mockResolvedValue([
      { id: 901, sub_schedule_id: 501, toJSON: () => ({ id: 901, sub_schedule_id: 501 }) },
    ]);
    jest.spyOn(ClaimsHistory, 'create').mockResolvedValue({ id: 902, sub_schedule_id: 501 });

    // Populate caches via read methods
    const vault = await vaultService.getVaultById(77);
    const subs = await vaultService.getSubSchedulesByVaultId(77);
    const claims = await vaultService.getClaimsBySubScheduleId(501);

    expect(vault).toEqual({ id: 77, address: '0xvault77', total_amount: '1000' });
    expect(subs).toEqual([{ id: 501, vault_id: 77 }]);
    expect(claims).toEqual([{ id: 901, sub_schedule_id: 501 }]);
    expect(Vault.findByPk).toHaveBeenCalledTimes(1);

    // Second read hits Redis cache
    await vaultService.getVaultById(77);
    expect(Vault.findByPk).toHaveBeenCalledTimes(1);

    // Write operation (claimVesting) invalidates vault, sub_schedule, and claims caches
    await vaultService.claimVesting({
      vaultId: 77,
      subScheduleId: 501,
      claimData: { amount_claimed: '100' },
    });

    expect(await cacheService.get('vesting:vault:77')).toBeNull();
    expect(await cacheService.get('vesting:sub_schedule:77')).toBeNull();
    expect(await cacheService.get('vesting:claims:501')).toBeNull();

    // Verify vestingService also exposes the cached getters
    expect(typeof vestingService.getVaultById).toBe('function');
    expect(typeof vestingService.getSubSchedulesByVaultId).toBe('function');
    expect(typeof vestingService.getClaimsBySubScheduleId).toBe('function');

    // Verify Prometheus metrics were recorded
    const metricsOutput = await metricsService.register.metrics();
    expect(metricsOutput).toContain('cache_operations_total');
    expect(metricsOutput).toContain('cache_operation_duration_seconds');
  });
});
