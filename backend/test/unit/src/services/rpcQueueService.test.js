const RpcQueueService = require('./rpcQueueService');
const QueueService = require('./queueService');
const SorobanRpcClient = require('./sorobanRpcClient');

// Mock dependencies
jest.mock('./queueService');
jest.mock('./sorobanRpcClient');
jest.mock('@sentry/node');
jest.mock('./slackWebhookService');

describe('RpcQueueService', () => {
  let rpcQueueService;
  let mockQueueService;
  let mockRpcClient;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock QueueService
    mockQueueService = {
      connect: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue(),
      getQueue: jest.fn(),
      getWorker: jest.fn(),
      addJob: jest.fn(),
      getQueueStats: jest.fn(),
      getFailedJobs: jest.fn(),
      deleteJob: jest.fn(),
      clearQueue: jest.fn(),
      pauseQueue: jest.fn(),
      resumeQueue: jest.fn(),
      getConnectionStatus: jest.fn(),
      healthCheck: jest.fn()
    };

    QueueService.mockImplementation(() => mockQueueService);

    // Mock SorobanRpcClient
    mockRpcClient = {
      call: jest.fn()
    };

    SorobanRpcClient.mockImplementation(() => mockRpcClient);

    // Mock queues
    const mockQueue = {
      add: jest.fn(),
      getJob: jest.fn()
    };

    mockQueueService.getQueue.mockReturnValue(mockQueue);

    // Create RPC queue service instance
    rpcQueueService = new RpcQueueService({
      maxRetries: 3,
      retryDelay: 2000,
      dlqMaxSize: 1000,
      priorityThreshold: 10
    });
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(rpcQueueService.maxRetries).toBe(3);
      expect(rpcQueueService.retryDelay).toBe(2000);
      expect(rpcQueueService.dlqMaxSize).toBe(1000);
      expect(rpcQueueService.priorityThreshold).toBe(10);
      expect(rpcQueueService.isStarted).toBe(false);
      expect(rpcQueueService.QUEUE_NAMES).toEqual({
        RPC_FETCH: 'rpc-fetch',
        DEAD_LETTER: 'rpc-dead-letter',
        PRIORITY_RPC: 'priority-rpc-fetch'
      });
    });

    it('should use default configuration', () => {
      const service = new RpcQueueService();
      
      expect(service.maxRetries).toBe(3);
      expect(service.retryDelay).toBe(2000);
      expect(service.dlqMaxSize).toBe(1000);
      expect(service.priorityThreshold).toBe(10);
    });
  });

  describe('start', () => {
    it('should start successfully', async () => {
      await rpcQueueService.start();

      expect(mockQueueService.connect).toHaveBeenCalled();
      expect(mockQueueService.getQueue).toHaveBeenCalledWith('rpc-fetch', expect.any(Object));
      expect(mockQueueService.getQueue).toHaveBeenCalledWith('rpc-dead-letter', expect.any(Object));
      expect(mockQueueService.getQueue).toHaveBeenCalledWith('priority-rpc-fetch', expect.any(Object));
      expect(mockQueueService.getWorker).toHaveBeenCalledWith('rpc-fetch', expect.any(Function), expect.any(Object));
      expect(mockQueueService.getWorker).toHaveBeenCalledWith('priority-rpc-fetch', expect.any(Function), expect.any(Object));
      expect(mockQueueService.getWorker).toHaveBeenCalledWith('rpc-dead-letter', expect.any(Function), expect.any(Object));
      expect(rpcQueueService.isStarted).toBe(true);
    });

    it('should throw error when already started', async () => {
      rpcQueueService.isStarted = true;

      await expect(rpcQueueService.start()).rejects.toThrow('RpcQueueService is already started');
    });

    it('should throw error when connection fails', async () => {
      mockQueueService.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(rpcQueueService.start()).rejects.toThrow('Connection failed');
      expect(rpcQueueService.isStarted).toBe(false);
    });
  });

  describe('stop', () => {
    it('should stop successfully', async () => {
      rpcQueueService.isStarted = true;

      await rpcQueueService.stop();

      expect(mockQueueService.disconnect).toHaveBeenCalled();
      expect(rpcQueueService.isStarted).toBe(false);
    });

    it('should throw error when not started', async () => {
      rpcQueueService.isStarted = false;

      await expect(rpcQueueService.stop()).rejects.toThrow('RpcQueueService is not started');
    });
  });

  describe('getRpcClient', () => {
    it('should create and return RPC client', () => {
      const rpcUrl = 'http://test-rpc-url';
      const client = rpcQueueService.getRpcClient(rpcUrl);

      expect(SorobanRpcClient).toHaveBeenCalledWith(rpcUrl, {
        timeout: 15000,
        maxRetries: 1,
        retryDelay: 0
      });
      expect(client).toBe(mockRpcClient);
    });

    it('should return existing RPC client', () => {
      const rpcUrl = 'http://test-rpc-url';
      const client1 = rpcQueueService.getRpcClient(rpcUrl);
      const client2 = rpcQueueService.getRpcClient(rpcUrl);

      expect(client1).toBe(client2);
      expect(SorobanRpcClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('addRpcJob', () => {
    it('should add RPC job successfully', async () => {
      rpcQueueService.isStarted = true;
      
      const mockJob = { id: 'job-123' };
      mockQueueService.addJob.mockResolvedValue(mockJob);

      const job = await rpcQueueService.addRpcJob('getEvents', { startLedger: 100, endLedger: 200 });

      expect(mockQueueService.addJob).toHaveBeenCalledWith('rpc-fetch', 'getEvents', {
        method: 'getEvents',
        params: { startLedger: 100, endLedger: 200 },
        rpcUrl: expect.any(String),
        timestamp: expect.any(Number),
        jobId: expect.any(String),
        metadata: {
          source: 'unknown',
          priority: 'normal',
          timeout: 15000
        }
      }, expect.any(Object));
      expect(job).toBe(mockJob);
      expect(rpcQueueService.stats.totalJobs).toBe(1);
    });

    it('should add high priority RPC job', async () => {
      rpcQueueService.isStarted = true;
      
      const mockJob = { id: 'job-456' };
      mockQueueService.addJob.mockResolvedValue(mockJob);

      const job = await rpcQueueService.addRpcJob('getLedger', {}, { priority: 'high' });

      expect(mockQueueService.addJob).toHaveBeenCalledWith('priority-rpc-fetch', 'getLedger', expect.any(Object), expect.any(Object));
      expect(job).toBe(mockJob);
    });

    it('should throw error when not started', async () => {
      rpcQueueService.isStarted = false;

      await expect(rpcQueueService.addRpcJob('getEvents', {})).rejects.toThrow('RpcQueueService is not started');
    });

    it('should throw error when addJob fails', async () => {
      rpcQueueService.isStarted = true;
      mockQueueService.addJob.mockRejectedValue(new Error('Queue error'));

      await expect(rpcQueueService.addRpcJob('getEvents', {})).rejects.toThrow('Queue error');
    });
  });

  describe('processRpcJob', () => {
    it('should process RPC job successfully', async () => {
      const mockJob = {
        id: 'job-123',
        data: {
          method: 'getEvents',
          params: { startLedger: 100 },
          rpcUrl: 'http://test-rpc-url',
          metadata: { timeout: 15000 }
        },
        attemptsMade: 0
      };

      mockRpcClient.call.mockResolvedValue({ events: [] });

      const result = await rpcQueueService.processRpcJob(mockJob);

      expect(mockRpcClient.call).toHaveBeenCalledWith('getEvents', { startLedger: 100 }, {
        timeout: 15000
      });
      expect(result).toEqual({
        success: true,
        result: { events: [] },
        metadata: {
          jobId: 'job-123',
          method: 'getEvents',
          duration: expect.any(Number),
          timestamp: expect.any(Number)
        }
      });
      expect(rpcQueueService.stats.successfulJobs).toBe(1);
    });

    it('should handle RPC job failure with retry', async () => {
      const mockJob = {
        id: 'job-123',
        data: {
          method: 'getEvents',
          params: { startLedger: 100 },
          rpcUrl: 'http://test-rpc-url',
          metadata: { timeout: 15000 }
        },
        attemptsMade: 1
      };

      mockRpcClient.call.mockRejectedValue(new Error('RPC Error'));

      await expect(rpcQueueService.processRpcJob(mockJob)).rejects.toThrow('RPC Error');
      expect(rpcQueueService.stats.retriedJobs).toBe(1);
    });

    it('should move job to DLQ on final failure', async () => {
      const mockJob = {
        id: 'job-123',
        data: {
          method: 'getEvents',
          params: { startLedger: 100 },
          rpcUrl: 'http://test-rpc-url',
          metadata: { timeout: 15000 }
        },
        attemptsMade: 2 // Will be 3 after this attempt
      };

      mockRpcClient.call.mockRejectedValue(new Error('RPC Error'));
      mockQueueService.addJob.mockResolvedValue({ id: 'dlq-job' });

      await expect(rpcQueueService.processRpcJob(mockJob)).rejects.toThrow('RPC Error');
      expect(mockQueueService.addJob).toHaveBeenCalledWith('rpc-dead-letter', 'dlq_getEvents', expect.any(Object), expect.any(Object));
      expect(rpcQueueService.stats.failedJobs).toBe(1);
      expect(rpcQueueService.stats.dlqJobs).toBe(1);
    });
  });

  describe('processDlqJob', () => {
    it('should process DLQ job successfully', async () => {
      const mockDlqJob = {
        id: 'dlq-123',
        data: {
          originalJobId: 'job-123',
          method: 'getEvents',
          error: { message: 'RPC Error' },
          attemptsMade: 3,
          duration: 5000,
          timestamp: Date.now(),
          metadata: {}
        }
      };

      const result = await rpcQueueService.processDlqJob(mockDlqJob);

      expect(result).toEqual({
        success: true,
        action: 'logged',
        metadata: {
          originalJobId: 'job-123',
          method: 'getEvents',
          error: 'RPC Error',
          attemptsMade: 3,
          processedAt: expect.any(Number)
        }
      });
      expect(rpcQueueService.stats.dlqJobs).toBe(1);
    });
  });

  describe('getStats', () => {
    it('should return queue statistics', async () => {
      mockQueueService.getQueueStats
        .mockResolvedValueOnce({ waiting: 5, active: 2, completed: 100, failed: 3, delayed: 1, total: 111 })
        .mockResolvedValueOnce({ waiting: 1, active: 1, completed: 50, failed: 1, delayed: 0, total: 53 })
        .mockResolvedValueOnce({ waiting: 2, active: 0, completed: 0, failed: 2, delayed: 0, total: 4 });

      rpcQueueService.stats = {
        totalJobs: 150,
        successfulJobs: 140,
        failedJobs: 8,
        dlqJobs: 2,
        retriedJobs: 5
      };

      const stats = await rpcQueueService.getStats();

      expect(stats).toEqual({
        service: {
          isStarted: false,
          redisStatus: expect.any(Object)
        },
        queues: {
          rpcFetch: { waiting: 5, active: 2, completed: 100, failed: 3, delayed: 1, total: 111 },
          priorityRpc: { waiting: 1, active: 1, completed: 50, failed: 1, delayed: 0, total: 53 },
          deadLetter: { waiting: 2, active: 0, completed: 0, failed: 2, delayed: 0, total: 4 }
        },
        jobs: {
          totalJobs: 150,
          successfulJobs: 140,
          failedJobs: 8,
          dlqJobs: 2,
          retriedJobs: 5,
          successRate: 93.33,
          failureRate: 5.33,
          dlqRate: 1.33
        }
      });
    });
  });

  describe('getDlqJobs', () => {
    it('should return DLQ jobs', async () => {
      const mockDlqJobs = [
        { id: 'dlq-1', method: 'getEvents', error: 'Error 1' },
        { id: 'dlq-2', method: 'getLedger', error: 'Error 2' }
      ];

      mockQueueService.getFailedJobs.mockResolvedValue(mockDlqJobs);

      const dlqJobs = await rpcQueueService.getDlqJobs(10);

      expect(mockQueueService.getFailedJobs).toHaveBeenCalledWith('rpc-dead-letter', 10);
      expect(dlqJobs).toEqual(mockDlqJobs);
    });
  });

  describe('retryDlqJob', () => {
    it('should retry DLQ job successfully', async () => {
      const mockDlqJob = {
        id: 'dlq-123',
        data: {
          method: 'getEvents',
          params: { startLedger: 100 },
          rpcUrl: 'http://test-rpc-url',
          metadata: { timeout: 15000 }
        },
        remove: jest.fn().mockResolvedValue()
      };

      const mockNewJob = { id: 'new-job-456' };
      mockQueueService.getQueue.mockReturnValue({ getJob: jest.fn().mockResolvedValue(mockDlqJob) });
      mockQueueService.addJob.mockResolvedValue(mockNewJob);

      const result = await rpcQueueService.retryDlqJob('dlq-123');

      expect(mockDlqJob.remove).toHaveBeenCalled();
      expect(mockQueueService.addJob).toHaveBeenCalledWith('rpc-fetch', 'getEvents', {
        startLedger: 100,
        rpcUrl: 'http://test-rpc-url',
        priority: 'high',
        source: 'dlq-retry',
        timeout: 15000
      });
      expect(result).toBe(mockNewJob);
    });

    it('should throw error when DLQ job not found', async () => {
      mockQueueService.getQueue.mockReturnValue({ getJob: jest.fn().mockResolvedValue(null) });

      await expect(rpcQueueService.retryDlqJob('non-existent')).rejects.toThrow('DLQ job non-existent not found');
    });
  });

  describe('deleteDlqJob', () => {
    it('should delete DLQ job successfully', async () => {
      const mockDlqJob = {
        id: 'dlq-123',
        remove: jest.fn().mockResolvedValue()
      };

      mockQueueService.getQueue.mockReturnValue({ getJob: jest.fn().mockResolvedValue(mockDlqJob) });

      const result = await rpcQueueService.deleteDlqJob('dlq-123');

      expect(mockDlqJob.remove).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when DLQ job not found', async () => {
      mockQueueService.getQueue.mockReturnValue({ getJob: jest.fn().mockResolvedValue(null) });

      const result = await rpcQueueService.deleteDlqJob('non-existent');

      expect(result).toBe(false);
    });
  });

  describe('clearDlq', () => {
    it('should clear DLQ successfully', async () => {
      await rpcQueueService.clearDlq();

      expect(mockQueueService.clearQueue).toHaveBeenCalledWith('rpc-dead-letter');
    });
  });

  describe('pauseQueues', () => {
    it('should pause RPC queues successfully', async () => {
      await rpcQueueService.pauseQueues();

      expect(mockQueueService.pauseQueue).toHaveBeenCalledWith('rpc-fetch');
      expect(mockQueueService.pauseQueue).toHaveBeenCalledWith('priority-rpc-fetch');
    });
  });

  describe('resumeQueues', () => {
    it('should resume RPC queues successfully', async () => {
      await rpcQueueService.resumeQueues();

      expect(mockQueueService.resumeQueue).toHaveBeenCalledWith('rpc-fetch');
      expect(mockQueueService.resumeQueue).toHaveBeenCalledWith('priority-rpc-fetch');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status', async () => {
      rpcQueueService.isStarted = true;
      mockQueueService.healthCheck.mockResolvedValue({
        status: 'healthy',
        redis: { connected: true },
        queues: []
      });
      mockQueueService.getQueueStats.mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0, total: 0 });

      const health = await rpcQueueService.healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.queue.status).toBe('healthy');
    });

    it('should return stopped status', async () => {
      rpcQueueService.isStarted = false;

      const health = await rpcQueueService.healthCheck();

      expect(health.status).toBe('stopped');
    });

    it('should return unhealthy status on error', async () => {
      rpcQueueService.isStarted = true;
      mockQueueService.healthCheck.mockRejectedValue(new Error('Health check failed'));

      const health = await rpcQueueService.healthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.error).toBe('Health check failed');
    });
  });

  describe('resetStats', () => {
    it('should reset statistics', () => {
      rpcQueueService.stats.totalJobs = 100;
      rpcQueueService.stats.successfulJobs = 90;

      rpcQueueService.resetStats();

      expect(rpcQueueService.stats).toEqual({
        totalJobs: 0,
        successfulJobs: 0,
        failedJobs: 0,
        dlqJobs: 0,
        retriedJobs: 0
      });
    });
  });
});
