/**
 * SorobanRpcClient Tests
 *
 * Tests for multi-endpoint failover, health checking, exponential backoff retry,
 * circuit breaker integration, and endpoint management.
 */

const SorobanRpcClient = require('./sorobanRpcClient');
const axios = require('axios');

// Mock dependencies
jest.mock('axios');
jest.mock('../resilience/circuitBreaker');
jest.mock('./auditLogger', () => ({
  logAction: jest.fn(),
}));
jest.mock('./metricsService', () => ({
  rpcEndpointHealth: { set: jest.fn() },
  rpcHealthCheckLatency: { observe: jest.fn() },
  rpcFailoverCount: { inc: jest.fn() },
  rpcRetryCount: { inc: jest.fn() },
}));
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

const CircuitBreaker = require('../resilience/circuitBreaker');

describe('SorobanRpcClient', () => {
  let client;
  let mockAxios;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset CircuitBreaker mock
    CircuitBreaker.mockImplementation(() => ({
      execute: jest.fn((op) => op()),
      onFailure: jest.fn(),
      onSuccess: jest.fn(),
      getState: jest.fn(() => ({ state: 'CLOSED', isOpen: false })),
      reset: jest.fn(),
    }));

    mockAxios = axios;
    // Default: all RPC calls succeed (health checks disabled via healthCheckInterval: 0 in tests)
    mockAxios.post.mockResolvedValue({ data: { result: { sequence: 12345 } } });
  });

  afterEach(() => {
    if (client) {
      client.stopHealthChecks();
    }
  });

  describe('Constructor and Endpoint Management', () => {
    test('should throw when no endpoints provided', () => {
      expect(() => new SorobanRpcClient([])).toThrow('At least one RPC endpoint URL is required');
    });

    test('should accept a single endpoint URL string', () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });
      expect(client.endpoints).toHaveLength(1);
      expect(client.endpoints[0].url).toBe('http://rpc1.example.com');
      expect(client.endpoints[0].priority).toBe(0);
    });

    test('should accept an array of endpoint URLs', () => {
      client = new SorobanRpcClient([
        'http://rpc1.example.com',
        'http://rpc2.example.com',
        'http://rpc3.example.com',
      ], { healthCheckInterval: 0 });
      expect(client.endpoints).toHaveLength(3);
      expect(client.endpoints[0].priority).toBe(0);
      expect(client.endpoints[1].priority).toBe(1);
      expect(client.endpoints[2].priority).toBe(2);
    });

    test('should accept endpoints with explicit priorities', () => {
      client = new SorobanRpcClient([
        { url: 'http://primary.example.com', priority: 0 },
        { url: 'http://secondary.example.com', priority: 1 },
        { url: 'http://fallback.example.com', priority: 2 },
      ], { healthCheckInterval: 0 });
      expect(client.endpoints).toHaveLength(3);
      expect(client.endpoints[0].priority).toBe(0);
      expect(client.endpoints[2].priority).toBe(2);
    });

    test('should NOT start health checks when interval is 0', () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });
      expect(client.healthCheckTimer).toBeNull();
    });

    test('should initialize health state for all endpoints', () => {
      client = new SorobanRpcClient([
        'http://rpc1.example.com',
        'http://rpc2.example.com',
      ], { healthCheckInterval: 0 });
      expect(client.endpointHealth.size).toBe(2);
      expect(client.endpointHealth.get('http://rpc1.example.com').healthy).toBe(true);
      expect(client.endpointHealth.get('http://rpc2.example.com').healthy).toBe(true);
    });

    test('should initialize circuit breakers for all endpoints', () => {
      client = new SorobanRpcClient([
        'http://rpc1.example.com',
        'http://rpc2.example.com',
      ], { healthCheckInterval: 0 });
      expect(client.circuitBreakers.size).toBe(2);
      expect(CircuitBreaker).toHaveBeenCalledTimes(2);
    });
  });

  describe('Health Checking', () => {
    test('should mark endpoint healthy on successful health check', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      mockAxios.post.mockResolvedValueOnce({ data: { result: { sequence: 12345 } } });

      const result = await client._healthCheckEndpoint('http://rpc1.example.com');
      expect(result.healthy).toBe(true);
      expect(result.latency).toBeGreaterThanOrEqual(0);
      expect(result.ledger).toBe(12345);
    });

    test('should mark endpoint unhealthy on failed health check', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      mockAxios.post.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await client._healthCheckEndpoint('http://rpc1.example.com');
      expect(result.healthy).toBe(false);
      expect(result.error).toBe('Connection refused');
    });

    test('should mark endpoint unhealthy on error response', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      mockAxios.post.mockResolvedValueOnce({ data: { error: { code: -32000, message: 'Internal error' } } });

      const result = await client._healthCheckEndpoint('http://rpc1.example.com');
      expect(result.healthy).toBe(false);
    });

    test('public healthCheck should use active endpoint when no URL specified', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      mockAxios.post.mockResolvedValueOnce({ data: { result: { sequence: 12345 } } });

      const result = await client.healthCheck();
      expect(result.healthy).toBe(true);
    });
  });

  describe('selectHealthyEndpoint() - Failover Logic', () => {
    test('should return highest priority healthy endpoint', () => {
      client = new SorobanRpcClient([
        { url: 'http://primary.example.com', priority: 0 },
        { url: 'http://secondary.example.com', priority: 1 },
      ], { healthCheckInterval: 0 });

      expect(client.selectHealthyEndpoint()).toBe('http://primary.example.com');
    });

    test('should fall back to next healthy endpoint when primary is degraded', () => {
      client = new SorobanRpcClient([
        { url: 'http://primary.example.com', priority: 0 },
        { url: 'http://secondary.example.com', priority: 1 },
      ], { healthCheckInterval: 0 });

      client.endpointHealth.set('http://primary.example.com', {
        healthy: false,
        degraded: true,
        lastCheck: Date.now(),
        lastLatency: 6000,
        consecutiveFailures: 3,
      });

      expect(client.selectHealthyEndpoint()).toBe('http://secondary.example.com');
    });

    test('should use degraded endpoint when all are unhealthy', () => {
      client = new SorobanRpcClient([
        { url: 'http://primary.example.com', priority: 0 },
        { url: 'http://secondary.example.com', priority: 1 },
      ], { healthCheckInterval: 0 });

      client.endpointHealth.set('http://primary.example.com', {
        healthy: false,
        degraded: false,
        lastCheck: Date.now(),
        consecutiveFailures: 10,
      });
      client.endpointHealth.set('http://secondary.example.com', {
        healthy: false,
        degraded: true,
        lastCheck: Date.now(),
        lastLatency: 3000,
        consecutiveFailures: 5,
      });

      expect(client.selectHealthyEndpoint()).toBe('http://secondary.example.com');
    });

    test('should return highest priority when all endpoints are completely dead', () => {
      client = new SorobanRpcClient([
        { url: 'http://primary.example.com', priority: 0 },
        { url: 'http://secondary.example.com', priority: 1 },
      ], { healthCheckInterval: 0 });

      client.endpointHealth.set('http://primary.example.com', {
        healthy: false,
        degraded: false,
        lastCheck: Date.now(),
        consecutiveFailures: 10,
      });
      client.endpointHealth.set('http://secondary.example.com', {
        healthy: false,
        degraded: false,
        lastCheck: Date.now(),
        consecutiveFailures: 10,
      });

      expect(client.selectHealthyEndpoint()).toBe('http://primary.example.com');
    });
  });

  describe('Retry Logic with Exponential Backoff', () => {
    test('should retry on transient errors with exponential backoff', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', {
        healthCheckInterval: 0,
        maxRetries: 3,
        retryDelay: 1000,
        maxRetryDelay: 30000,
      });

      // Fail 3 times (attempts 0, 1, 2), succeed on 4th (attempt 3)
      mockAxios.post
        .mockRejectedValueOnce(new Error('Network error: Unable to reach Soroban RPC server'))
        .mockRejectedValueOnce(new Error('Network error: Unable to reach Soroban RPC server'))
        .mockRejectedValueOnce(new Error('Network error: Unable to reach Soroban RPC server'))
        .mockResolvedValueOnce({ data: { result: { value: 'success' } } });

      // Mock _delay to resolve immediately
      jest.spyOn(client, '_delay').mockResolvedValue(undefined);

      const result = await client.callWithRetry('getNetwork', {});

      expect(result).toEqual({ value: 'success' });
      // maxRetries=3 means up to 4 attempts (0,1,2,3) on one endpoint
      expect(mockAxios.post).toHaveBeenCalledTimes(4);
      expect(client.metrics.retriedCalls).toBe(3);

      client._delay.mockRestore();
    });

    test('should use exponential backoff delays: 1s, 2s, 4s, 8s, 16s', async () => {
      client = new SorobanRpcClient('http://rpc2.example.com', {
        healthCheckInterval: 0,
        maxRetries: 5,
        retryDelay: 1000,
        maxRetryDelay: 30000,
      });

      mockAxios.post.mockRejectedValue(new Error('Network error'));
      const delaySpy = jest.spyOn(client, '_delay').mockResolvedValue(undefined);

      await expect(client.callWithRetry('getNetwork', {})).rejects.toThrow('Network error');

      const delays = delaySpy.mock.calls.map(call => call[0]);
      expect(delays).toEqual([1000, 2000, 4000, 8000, 16000]);

      delaySpy.mockRestore();
    });

    test('should cap backoff delay at maxRetryDelay (30s)', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', {
        healthCheckInterval: 0,
        maxRetries: 10,
        retryDelay: 1000,
        maxRetryDelay: 30000,
      });

      mockAxios.post.mockRejectedValue(new Error('Network error'));
      const delaySpy = jest.spyOn(client, '_delay').mockResolvedValue(undefined);

      await expect(client.callWithRetry('getNetwork', {})).rejects.toThrow('Network error');

      const delays = delaySpy.mock.calls.map(call => call[0]);
      expect(delays[0]).toBe(1000);
      expect(delays[1]).toBe(2000);
      expect(delays[2]).toBe(4000);
      expect(delays[3]).toBe(8000);
      expect(delays[4]).toBe(16000);
      for (let i = 5; i < delays.length; i++) {
        expect(delays[i]).toBe(30000);
      }

      delaySpy.mockRestore();
    });

    test('should not retry on non-retryable errors', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      mockAxios.post.mockRejectedValueOnce(new Error('Invalid parameter: foo'));

      await expect(client.callWithRetry('getTransaction', { hash: 'abc' }))
        .rejects.toThrow('Invalid parameter');

      // Non-retryable errors throw immediately - single endpoint, single call
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(client.metrics.retriedCalls).toBe(0);
    });

    test('should retry on 503 Service Unavailable errors', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', {
        healthCheckInterval: 0,
        maxRetries: 2,
      });

      jest.spyOn(client, '_delay').mockResolvedValue(undefined);

      const error503 = new Error('HTTP 503: Service Unavailable');
      error503.response = { status: 503, statusText: 'Service Unavailable' };

      // 503 is retryable - fails on attempt 0, succeeds on retry (attempt 1)
      mockAxios.post
        .mockRejectedValueOnce(error503)
        .mockResolvedValueOnce({ data: { result: { value: 'ok' } } });

      const result = await client.callWithRetry('getNetwork', {});
      expect(result).toEqual({ value: 'ok' });
      expect(mockAxios.post).toHaveBeenCalledTimes(2);

      client._delay.mockRestore();
    });

    test('should retry on 429 Too Many Requests errors', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', {
        healthCheckInterval: 0,
        maxRetries: 2,
      });

      jest.spyOn(client, '_delay').mockResolvedValue(undefined);

      const error429 = new Error('HTTP 429: Too Many Requests');
      error429.response = { status: 429, statusText: 'Too Many Requests' };

      mockAxios.post
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({ data: { result: { value: 'ok' } } });

      const result = await client.callWithRetry('getNetwork', {});
      expect(result).toEqual({ value: 'ok' });

      client._delay.mockRestore();
    });

    test('should retry on timeout errors', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', {
        healthCheckInterval: 0,
        maxRetries: 2,
      });

      jest.spyOn(client, '_delay').mockResolvedValue(undefined);

      const timeoutError = new Error('Network timeout');
      timeoutError.code = 'ETIMEDOUT';

      mockAxios.post
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({ data: { result: { value: 'ok' } } });

      const result = await client.callWithRetry('getNetwork', {});
      expect(result).toEqual({ value: 'ok' });

      client._delay.mockRestore();
    });
  });

  describe('Multi-Endpoint Failover', () => {
    test('should try next endpoint on primary failure', async () => {
      client = new SorobanRpcClient([
        { url: 'http://primary.example.com', priority: 0 },
        { url: 'http://secondary.example.com', priority: 1 },
      ], {
        healthCheckInterval: 0,
        maxRetries: 0, // No retries = 1 attempt per endpoint
      });

      // Primary fails with network error, secondary succeeds
      mockAxios.post
        .mockRejectedValueOnce(new Error('Network error: Unable to reach Soroban RPC server'))
        .mockResolvedValueOnce({ data: { result: { value: 'from_secondary' } } });

      const result = await client.callWithRetry('getNetwork', {});
      expect(result).toEqual({ value: 'from_secondary' });
    });

    test('should exhaust all endpoints before giving up', async () => {
      client = new SorobanRpcClient([
        { url: 'http://rpc1.example.com', priority: 0 },
        { url: 'http://rpc2.example.com', priority: 1 },
        { url: 'http://rpc3.example.com', priority: 2 },
      ], {
        healthCheckInterval: 0,
        maxRetries: 0, // One attempt per endpoint, no retries
      });

      // All endpoints fail with network errors (not reject the promise, need to throw errors)
      mockAxios.post
        .mockRejectedValueOnce(new Error('Network error: Unable to reach Soroban RPC server'))
        .mockRejectedValueOnce(new Error('Network error: Unable to reach Soroban RPC server'))
        .mockRejectedValueOnce(new Error('Network error: Unable to reach Soroban RPC server'));

      await expect(client.callWithRetry('getNetwork', {})).rejects.toThrow('Network error');
      // One attempt per endpoint, 3 endpoints
      expect(mockAxios.post).toHaveBeenCalledTimes(3);
    });
  });

  describe('Circuit Breaker Integration', () => {
    test('should record failures in circuit breaker', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      const cb = client.circuitBreakers.get('http://rpc1.example.com');

      mockAxios.post.mockRejectedValueOnce(new Error('Network error'));

      await expect(client.call('getNetwork', {})).rejects.toThrow('Network error');

      expect(cb.onFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceName: 'soroban-rpc',
          endpoint: 'http://rpc1.example.com',
        })
      );
    });

    test('executeWithCircuitBreaker should pass through to circuit breaker', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      const operation = jest.fn().mockResolvedValue('result');

      const result = await client.executeWithCircuitBreaker(operation, { name: 'test_op' });

      expect(result).toBe('result');
      const cb = client.circuitBreakers.get('http://rpc1.example.com');
      expect(cb.execute).toHaveBeenCalledWith(
        operation,
        expect.objectContaining({
          name: 'test_op',
          serviceName: 'soroban-rpc',
        })
      );
    });
  });

  describe('Metrics and Health Status', () => {
    test('getHealthStatus should return endpoint health information', () => {
      client = new SorobanRpcClient([
        { url: 'http://rpc1.example.com', priority: 0 },
        { url: 'http://rpc2.example.com', priority: 1 },
      ], { healthCheckInterval: 0 });

      const status = client.getHealthStatus();
      expect(status.activeEndpoint).toBe('http://rpc1.example.com');
      expect(status.failoverCount).toBe(0);
      expect(status.endpoints['http://rpc1.example.com'].healthy).toBe(true);
      expect(status.endpoints['http://rpc2.example.com'].healthy).toBe(true);
    });

    test('getMetrics should return comprehensive metrics', () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      const metrics = client.getMetrics();
      expect(metrics).toHaveProperty('totalCalls');
      expect(metrics).toHaveProperty('successfulCalls');
      expect(metrics).toHaveProperty('failedCalls');
      expect(metrics).toHaveProperty('failoverEvents');
      expect(metrics).toHaveProperty('activeEndpoint');
      expect(metrics).toHaveProperty('endpointHealth');
    });

    test('should track failover count', () => {
      client = new SorobanRpcClient([
        { url: 'http://rpc1.example.com', priority: 0 },
        { url: 'http://rpc2.example.com', priority: 1 },
      ], { healthCheckInterval: 0 });

      client.endpointHealth.set('http://rpc1.example.com', {
        healthy: false,
        degraded: true,
        lastCheck: Date.now(),
        consecutiveFailures: 5,
      });
      client._autoSelectEndpoint();

      expect(client.failoverCount).toBe(1);
    });
  });

  describe('Dynamic Endpoint Management', () => {
    test('addEndpoint should add new endpoint', () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      client.addEndpoint('http://rpc2.example.com', 1);
      expect(client.endpoints).toHaveLength(2);
      expect(client.endpointHealth.has('http://rpc2.example.com')).toBe(true);
      expect(client.circuitBreakers.has('http://rpc2.example.com')).toBe(true);
    });

    test('addEndpoint should not duplicate existing endpoints', () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      client.addEndpoint('http://rpc1.example.com', 1);
      expect(client.endpoints).toHaveLength(1);
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    test('removeEndpoint should remove endpoint and its health state', () => {
      client = new SorobanRpcClient([
        { url: 'http://rpc1.example.com', priority: 0 },
        { url: 'http://rpc2.example.com', priority: 1 },
      ], { healthCheckInterval: 0 });

      client.removeEndpoint('http://rpc2.example.com');
      expect(client.endpoints).toHaveLength(1);
      expect(client.endpointHealth.has('http://rpc2.example.com')).toBe(false);
    });

    test('removeEndpoint should throw for non-existent endpoint', () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      expect(() => client.removeEndpoint('http://nonexistent.example.com'))
        .toThrow('Endpoint http://nonexistent.example.com not found');
    });

    test('removeEndpoint should select new active when removing active', () => {
      client = new SorobanRpcClient([
        { url: 'http://rpc1.example.com', priority: 0 },
        { url: 'http://rpc2.example.com', priority: 1 },
      ], { healthCheckInterval: 0 });

      expect(client.activeEndpoint).toBe('http://rpc1.example.com');
      client.removeEndpoint('http://rpc1.example.com');
      expect(client.activeEndpoint).toBe('http://rpc2.example.com');
    });
  });

  describe('forceEndpoint', () => {
    test('should force switch to specified endpoint', () => {
      client = new SorobanRpcClient([
        { url: 'http://rpc1.example.com', priority: 0 },
        { url: 'http://rpc2.example.com', priority: 1 },
      ], { healthCheckInterval: 0 });

      client.forceEndpoint('http://rpc2.example.com');
      expect(client.activeEndpoint).toBe('http://rpc2.example.com');
    });

    test('should throw for non-configured endpoint', () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      expect(() => client.forceEndpoint('http://unknown.example.com'))
        .toThrow('is not in the configured endpoint list');
    });
  });

  describe('Convenience Methods', () => {
    test('getLatestLedger should call with retry', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      mockAxios.post.mockResolvedValueOnce({ data: { result: { sequence: 12345 } } });

      const result = await client.getLatestLedger();
      expect(result).toEqual({ sequence: 12345 });
    });

    test('getEvents should include startLedger and endLedger in params', async () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      mockAxios.post.mockResolvedValueOnce({ data: { result: { events: [] } } });

      const result = await client.getEvents(100, 200);
      expect(result).toEqual({ events: [] });
      expect(mockAxios.post).toHaveBeenCalledWith(
        'http://rpc1.example.com',
        expect.objectContaining({
          method: 'getEvents',
          params: { startLedger: 100, endLedger: 200 },
        }),
        expect.any(Object)
      );
    });
  });

  describe('Stop Health Checks', () => {
    test('stopHealthChecks should clear the interval', () => {
      client = new SorobanRpcClient('http://rpc1.example.com', { healthCheckInterval: 0 });

      expect(client.healthCheckTimer).toBeNull();
      // No-op when already stopped
      client.stopHealthChecks();
      expect(client.healthCheckTimer).toBeNull();
    });
  });
});
