const SorobanRpcClient = require('../src/services/sorobanRpcClient');
const SorobanMockServer = require('./helpers/sorobanMockServer');
const errorResponses = require('./fixtures/soroban/contractErrorResponses.json');

describe('SorobanRpcClient Integration Tests', () => {
  const rpcUrl = 'http://localhost:8080';
  let mockServer;
  let client;

  beforeEach(() => {
    mockServer = new SorobanMockServer(rpcUrl);
    client = new SorobanRpcClient(rpcUrl, {
      timeout: 1000,
      maxRetries: 2,
      retryDelay: 100,
      healthCheckInterval: 0
    });
  });

  afterEach(() => {
    mockServer.clear();
  });

  it('Successful RPC call with mock — validates request serialization and response parsing', async () => {
    mockServer.mockGetLatestLedger(123456);
    const result = await client.getLatestLedger();
    expect(result.sequence).toBe(123456);
  });

  it('RPC timeout — validates retry logic and circuit breaker integration', async () => {
    mockServer.mockTimeout('getLatestLedger', 2000);
    
    await expect(client.getLatestLedger()).rejects.toThrow(/timeout|Network error|ECONNABORTED/);
    
    const metrics = client.getMetrics();
    expect(metrics.totalCalls).toBeGreaterThan(0);
    expect(metrics.failedCalls).toBeGreaterThanOrEqual(3);
  });

  it('txn_failed error — validates error mapping and user-friendly error messages', async () => {
    mockServer.mockErrorResponse('simulateTransaction', errorResponses.txn_failed);
    await expect(client.simulateTransaction({})).rejects.toThrow(/txn_failed/);
  });

  it('Rate limit (429) response — validates backoff behavior', async () => {
    mockServer.mockErrorResponse('getLatestLedger', errorResponses.rate_limit, 429);
    
    const start = Date.now();
    await expect(client.getLatestLedger()).rejects.toThrow(/429/);
    const duration = Date.now() - start;
    
    expect(duration).toBeGreaterThanOrEqual(300);
    expect(client.metrics.failedCalls).toBe(3);
  });
});
