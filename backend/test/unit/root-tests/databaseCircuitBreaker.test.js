/**
 * Database Circuit Breaker Tests
 * 
 * Tests for the circuit breaker implementation during mass unlock events
 */

const { DatabaseCircuitBreaker } = require('../src/utils/databaseCircuitBreaker');
const { DatabaseCircuitBreakerMonitor } = require('../src/services/databaseCircuitBreakerMonitor');

describe('DatabaseCircuitBreaker', () => {
  let circuitBreaker;
  let mockLogger;
  let mockAlertService;

  beforeEach(() => {
    mockLogger = {
      warn: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    mockAlertService = {
      sendAlert: jest.fn().mockResolvedValue(true)
    };

    circuitBreaker = new DatabaseCircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000,
      maxConcurrentWrites: 5,
      writeTimeoutThreshold: 100,
      massUnlockThreshold: 10,
      massUnlockWindow: 1000,
      batchSize: 2,
      onStateChange: jest.fn(),
      onMassUnlockDetected: jest.fn(),
      onThrottlingAdjustment: jest.fn()
    });
  });

  afterEach(() => {
    if (circuitBreaker) {
      circuitBreaker.reset();
    }
  });

  describe('Basic Circuit Breaker Functionality', () => {
    test('should start in CLOSED state', () => {
      const state = circuitBreaker.getState();
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(0);
    });

    test('should execute successful write operations', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      const result = await circuitBreaker.executeWrite(mockOperation, {
        operation: 'test'
      });

      expect(result).toBe('success');
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    test('should handle write operation failures', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Database error'));
      
      await expect(circuitBreaker.executeWrite(mockOperation, {
        operation: 'test'
      })).rejects.toThrow('Database error');

      const state = circuitBreaker.getState();
      expect(state.failureCount).toBe(1);
    });

    test('should open circuit after failure threshold', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Database error'));
      
      // Fail 3 times to trigger circuit opening
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.executeWrite(mockOperation, { operation: 'test' });
        } catch (error) {
          // Expected to fail
        }
      }

      const state = circuitBreaker.getState();
      expect(state.state).toBe('OPEN');
    });

    test('should reject operations when circuit is open', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success');
      
      // Trigger circuit opening
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.executeWrite(() => Promise.reject(new Error('Fail')), { operation: 'test' });
        } catch (error) {
          // Expected to fail
        }
      }

      // Should reject immediately when circuit is open
      await expect(circuitBreaker.executeWrite(mockOperation, {
        operation: 'test'
      })).rejects.toThrow('circuit breaker is OPEN');
    });
  });

  describe('Mass Unlock Detection', () => {
    test('should detect mass unlock events', async () => {
      const mockOperations = Array(15).fill().map(() => 
        jest.fn().mockResolvedValue('success')
      );

      // Execute enough operations to trigger mass unlock detection
      for (const operation of mockOperations) {
        await circuitBreaker.executeWrite(operation, { operation: 'test' });
      }

      const state = circuitBreaker.getState();
      expect(state.recentEventCount).toBeGreaterThan(10);
      expect(state.state).toBe('THROTTLING');
    });

    test('should adjust throttling level based on load', async () => {
      // Simulate high load by triggering mass unlock
      const mockOperations = Array(12).fill().map(() => 
        jest.fn().mockResolvedValue('success')
      );

      for (const operation of mockOperations) {
        await circuitBreaker.executeWrite(operation, { operation: 'test' });
      }

      const state = circuitBreaker.getState();
      expect(state.throttlingLevel).toBeGreaterThan(0);
    });
  });

  describe('Batch Processing', () => {
    test('should process batch operations correctly', async () => {
      const mockOperations = [
        jest.fn().mockResolvedValue('result1'),
        jest.fn().mockResolvedValue('result2'),
        jest.fn().mockResolvedValue('result3'),
        jest.fn().mockResolvedValue('result4')
      ];

      const results = await circuitBreaker.executeBatchWrite(mockOperations, {
        operation: 'batch_test'
      });

      expect(results).toHaveLength(4);
      expect(mockOperations[0]).toHaveBeenCalledTimes(1);
      expect(mockOperations[1]).toHaveBeenCalledTimes(1);
      expect(mockOperations[2]).toHaveBeenCalledTimes(1);
      expect(mockOperations[3]).toHaveBeenCalledTimes(1);
    });

    test('should handle partial batch failures', async () => {
      const mockOperations = [
        jest.fn().mockResolvedValue('result1'),
        jest.fn().mockRejectedValue(new Error('Batch error')),
        jest.fn().mockResolvedValue('result3'),
        jest.fn().mockRejectedValue(new Error('Another error'))
      ];

      const results = await circuitBreaker.executeBatchWrite(mockOperations, {
        operation: 'batch_test'
      });

      expect(results).toHaveLength(4);
      expect(results[0]).toBe('result1');
      expect(results[1]).toHaveProperty('error');
      expect(results[2]).toBe('result3');
      expect(results[3]).toHaveProperty('error');
    });
  });

  describe('Concurrent Write Limits', () => {
    test('should respect concurrent write limits', async () => {
      const slowOperation = () => new Promise(resolve => setTimeout(resolve, 200));
      const mockOperations = Array(10).fill().map(() => slowOperation);

      // Start all operations concurrently
      const promises = mockOperations.map((op, index) => 
        circuitBreaker.executeWrite(op, { operation: `concurrent_${index}` })
      );

      const results = await Promise.allSettled(promises);
      
      // Some should succeed, some should be throttled
      const successful = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');
      
      expect(successful.length).toBeLessThanOrEqual(5); // maxConcurrentWrites
      expect(rejected.length).toBeGreaterThan(0);
    });
  });

  describe('Statistics and Monitoring', () => {
    test('should track statistics correctly', async () => {
      const successOp = jest.fn().mockResolvedValue('success');
      const failOp = jest.fn().mockRejectedValue(new Error('Failed'));

      // Successful operations
      await circuitBreaker.executeWrite(successOp, { operation: 'success' });
      await circuitBreaker.executeWrite(successOp, { operation: 'success' });

      // Failed operations
      try {
        await circuitBreaker.executeWrite(failOp, { operation: 'fail' });
      } catch (error) {
        // Expected
      }

      const stats = circuitBreaker.getStats();
      expect(stats.totalWrites).toBe(3);
      expect(stats.successfulWrites).toBe(2);
      expect(stats.failedWrites).toBe(1);
    });

    test('should provide detailed state information', () => {
      const state = circuitBreaker.getState();
      
      expect(state).toHaveProperty('state');
      expect(state).toHaveProperty('failureCount');
      expect(state).toHaveProperty('throttlingLevel');
      expect(state).toHaveProperty('activeWrites');
      expect(state).toHaveProperty('stats');
    });
  });

  describe('Graceful Degradation', () => {
    test('should continue processing when circuit is throttling', async () => {
      // Trigger throttling mode
      const mockOperations = Array(15).fill().map(() => 
        jest.fn().mockResolvedValue('success')
      );

      for (const operation of mockOperations) {
        await circuitBreaker.executeWrite(operation, { operation: 'test' });
      }

      const state = circuitBreaker.getState();
      expect(state.state).toBe('THROTTLING');

      // Should still be able to process operations, albeit slower
      const anotherOp = jest.fn().mockResolvedValue('still_works');
      const result = await circuitBreaker.executeWrite(anotherOp, { operation: 'throttled_test' });
      
      expect(result).toBe('still_works');
    });

    test('should recover gracefully after reset timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.executeWrite(() => Promise.reject(new Error('Fail')), { operation: 'test' });
        } catch (error) {
          // Expected
        }
      }

      expect(circuitBreaker.getState().state).toBe('OPEN');

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should attempt reset and allow operations
      const mockOp = jest.fn().mockResolvedValue('recovered');
      const result = await circuitBreaker.executeWrite(mockOp, { operation: 'recovery_test' });
      
      expect(result).toBe('recovered');
      expect(circuitBreaker.getState().state).toBe('HALF_OPEN');
    });
  });
});

describe('DatabaseCircuitBreakerMonitor', () => {
  let monitor;
  let mockLogger;
  let mockAlertService;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockAlertService = {
      sendAlert: jest.fn().mockResolvedValue(true),
      testConnection: jest.fn().mockResolvedValue(true)
    };

    monitor = new DatabaseCircuitBreakerMonitor(
      {
        enabled: true,
        alertThresholds: {
          failureRate: 0.5,
          throttlingLevel: 80,
          massUnlockCount: 10
        }
      },
      {
        logger: mockLogger,
        alertService: mockAlertService
      }
    );
  });

  describe('Alerting', () => {
    test('should send alert on circuit breaker state change', async () => {
      const stateChange = {
        fromState: 'CLOSED',
        toState: 'OPEN',
        reason: 'Failure threshold reached',
        timestamp: Date.now(),
        stats: {
          failureCount: 5,
          throttlingLevel: 0
        }
      };

      await monitor.onStateChange(stateChange);

      expect(mockAlertService.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'circuit_breaker_state_change',
          severity: 'critical',
          title: expect.stringContaining('OPEN')
        })
      );
    });

    test('should send alert on mass unlock detection', async () => {
      const massUnlock = {
        eventCount: 15,
        window: 60000,
        timestamp: Date.now()
      };

      await monitor.onMassUnlockDetected(massUnlock);

      expect(mockAlertService.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mass_unlock_detected',
          severity: 'warning',
          title: 'Mass Unlock Event Detected'
        })
      );
    });

    test('should respect cooldown periods', async () => {
      const stateChange = {
        fromState: 'CLOSED',
        toState: 'OPEN',
        reason: 'Failure threshold reached',
        timestamp: Date.now(),
        stats: { failureCount: 5, throttlingLevel: 0 }
      };

      // First alert should be sent
      await monitor.onStateChange(stateChange);
      expect(mockAlertService.sendAlert).toHaveBeenCalledTimes(1);

      // Second alert within cooldown should not be sent
      await monitor.onStateChange(stateChange);
      expect(mockAlertService.sendAlert).toHaveBeenCalledTimes(1);
    });
  });

  describe('Statistics', () => {
    test('should track monitoring statistics', () => {
      const stats = monitor.getStats();
      
      expect(stats).toHaveProperty('totalAlerts');
      expect(stats).toHaveProperty('stateChangeAlerts');
      expect(stats).toHaveProperty('massUnlockAlerts');
      expect(stats).toHaveProperty('uptime');
    });

    test('should provide performance summary', () => {
      // Add some performance data
      monitor.updatePerformanceHistory({
        timestamp: Date.now(),
        state: 'THROTTLING',
        throttlingLevel: 75,
        averageWriteTime: 150
      });

      const summary = monitor.getPerformanceSummary();
      
      if (summary) {
        expect(summary).toHaveProperty('averageWriteTime');
        expect(summary).toHaveProperty('averageThrottlingLevel');
        expect(summary).toHaveProperty('stateDistribution');
      }
    });
  });
});

describe('Integration Tests', () => {
  test('should handle realistic mass unlock scenario', async () => {
    const circuitBreaker = new DatabaseCircuitBreaker({
      failureThreshold: 10,
      resetTimeout: 5000,
      maxConcurrentWrites: 20,
      writeTimeoutThreshold: 1000,
      massUnlockThreshold: 25,
      massUnlockWindow: 2000,
      batchSize: 5
    });

    const monitor = new DatabaseCircuitBreakerMonitor(
      { enabled: true },
      { logger: console, alertService: null }
    );

    // Simulate mass unlock with 30 rapid operations
    const operations = Array(30).fill().map((_, i) => 
      jest.fn().mockResolvedValue(`operation_${i}`)
    );

    const startTime = Date.now();
    const results = await Promise.allSettled(
      operations.map((op, i) => 
        circuitBreaker.executeWrite(op, { operation: `mass_unlock_${i}` })
      )
    );
    const endTime = Date.now();

    // Verify results
    const successful = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');

    expect(successful.length).toBeGreaterThan(0);
    expect(failed.length).toBeGreaterThan(0);

    // Verify circuit breaker behavior
    const state = circuitBreaker.getState();
    expect(state.state).toBe('THROTTLING');
    expect(state.throttlingLevel).toBeGreaterThan(0);

    // Verify statistics
    const stats = circuitBreaker.getStats();
    expect(stats.totalWrites).toBe(30);
    expect(stats.throttledWrites).toBeGreaterThan(0);
    expect(stats.massUnlockEvents).toBeGreaterThan(0);

    console.log(`Mass unlock test completed in ${endTime - startTime}ms`);
    console.log(`Successful: ${successful.length}, Failed: ${failed.length}`);
    console.log(`Circuit breaker state: ${state.state}, Throttling: ${state.throttlingLevel}%`);
  });
});
