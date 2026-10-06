const QueueService = require('./queueService');
const IORedis = require('ioredis');

// Mock dependencies
jest.mock('ioredis');
jest.mock('@sentry/node');

describe('QueueService', () => {
  let queueService;
  let mockRedis;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock Redis connection
    mockRedis = {
      connect: jest.fn().mockResolvedValue(),
      disconnect: jest.fn().mockResolvedValue(),
      ping: jest.fn().mockResolvedValue('PONG'),
      status: 'ready',
      on: jest.fn()
    };

    IORedis.mockImplementation(() => mockRedis);

    // Create queue service instance
    queueService = new QueueService({
      redisHost: 'localhost',
      redisPort: 6379,
      redisDb: 0
    });
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(queueService.redisConfig.host).toBe('localhost');
      expect(queueService.redisConfig.port).toBe(6379);
      expect(queueService.redisConfig.db).toBe(0);
      expect(queueService.queues.size).toBe(0);
      expect(queueService.workers.size).toBe(0);
      expect(queueService.isReady).toBe(false);
    });

    it('should use environment variables as defaults', () => {
      process.env.REDIS_HOST = 'test-host';
      process.env.REDIS_PORT = '6380';
      process.env.REDIS_DB = '1';

      const service = new QueueService();
      
      expect(service.redisConfig.host).toBe('test-host');
      expect(service.redisConfig.port).toBe(6380);
      expect(service.redisConfig.db).toBe(1);

      // Clean up
      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      delete process.env.REDIS_DB;
    });
  });

  describe('connect', () => {
    it('should connect to Redis successfully', async () => {
      await queueService.connect();

      expect(mockRedis.connect).toHaveBeenCalled();
      expect(queueService.isReady).toBe(true);
    });

    it('should throw error when connection fails', async () => {
      mockRedis.connect.mockRejectedValue(new Error('Connection failed'));

      await expect(queueService.connect()).rejects.toThrow('Connection failed');
      expect(queueService.isReady).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from Redis successfully', async () => {
      // Mock some queues and workers
      const mockQueue = { close: jest.fn().mockResolvedValue() };
      const mockWorker = { close: jest.fn().mockResolvedValue() };
      
      queueService.queues.set('test-queue', mockQueue);
      queueService.workers.set('test-worker', mockWorker);

      await queueService.disconnect();

      expect(mockWorker.close).toHaveBeenCalled();
      expect(mockQueue.close).toHaveBeenCalled();
      expect(mockRedis.disconnect).toHaveBeenCalled();
      expect(queueService.isReady).toBe(false);
    });
  });

  describe('getQueue', () => {
    it('should create and return a new queue', () => {
      const queue = queueService.getQueue('test-queue');

      expect(queueService.queues.has('test-queue')).toBe(true);
      expect(queue).toBeDefined();
    });

    it('should return existing queue', () => {
      const queue1 = queueService.getQueue('test-queue');
      const queue2 = queueService.getQueue('test-queue');

      expect(queue1).toBe(queue2);
      expect(queueService.queues.size).toBe(1);
    });
  });

  describe('getWorker', () => {
    it('should create and return a new worker', () => {
      const processor = jest.fn();
      const worker = queueService.getWorker('test-queue', processor);

      expect(queueService.workers.has('test-queue')).toBe(true);
      expect(worker).toBeDefined();
    });

    it('should return existing worker', () => {
      const processor = jest.fn();
      const worker1 = queueService.getWorker('test-queue', processor);
      const worker2 = queueService.getWorker('test-queue', processor);

      expect(worker1).toBe(worker2);
      expect(queueService.workers.size).toBe(1);
    });
  });

  describe('addJob', () => {
    it('should add job to queue successfully', async () => {
      const mockJob = { id: 'job-123', name: 'test-job' };
      const mockQueue = { add: jest.fn().mockResolvedValue(mockJob) };
      
      queueService.queues.set('test-queue', mockQueue);

      const job = await queueService.addJob('test-queue', 'test-job', { test: 'data' });

      expect(mockQueue.add).toHaveBeenCalledWith('test-job', { test: 'data' }, expect.any(Object));
      expect(job).toBe(mockJob);
    });

    it('should throw error when queue add fails', async () => {
      const mockQueue = { add: jest.fn().mockRejectedValue(new Error('Queue error')) };
      queueService.queues.set('test-queue', mockQueue);

      await expect(queueService.addJob('test-queue', 'test-job', {})).rejects.toThrow('Queue error');
    });
  });

  describe('getQueueStats', () => {
    it('should return queue statistics', async () => {
      const mockQueue = {
        getWaiting: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
        getActive: jest.fn().mockResolvedValue([{ id: 3 }]),
        getCompleted: jest.fn().mockResolvedValue([{ id: 4 }, { id: 5 }, { id: 6 }]),
        getFailed: jest.fn().mockResolvedValue([{ id: 7 }]),
        getDelayed: jest.fn().mockResolvedValue([])
      };
      
      queueService.queues.set('test-queue', mockQueue);

      const stats = await queueService.getQueueStats('test-queue');

      expect(stats).toEqual({
        queueName: 'test-queue',
        waiting: 2,
        active: 1,
        completed: 3,
        failed: 1,
        delayed: 0,
        total: 7
      });
    });

    it('should handle queue errors gracefully', async () => {
      const mockQueue = {
        getWaiting: jest.fn().mockRejectedValue(new Error('Queue error'))
      };
      
      queueService.queues.set('test-queue', mockQueue);

      await expect(queueService.getQueueStats('test-queue')).rejects.toThrow('Queue error');
    });
  });

  describe('getAllQueueStats', () => {
    it('should return statistics for all queues', async () => {
      const mockQueue1 = {
        getWaiting: jest.fn().mockResolvedValue([]),
        getActive: jest.fn().mockResolvedValue([]),
        getCompleted: jest.fn().mockResolvedValue([]),
        getFailed: jest.fn().mockResolvedValue([]),
        getDelayed: jest.fn().mockResolvedValue([])
      };
      
      const mockQueue2 = {
        getWaiting: jest.fn().mockResolvedValue([]),
        getActive: jest.fn().mockResolvedValue([]),
        getCompleted: jest.fn().mockResolvedValue([]),
        getFailed: jest.fn().mockResolvedValue([]),
        getDelayed: jest.fn().mockResolvedValue([])
      };

      queueService.queues.set('queue1', mockQueue1);
      queueService.queues.set('queue2', mockQueue2);

      const stats = await queueService.getAllQueueStats();

      expect(stats).toHaveLength(2);
      expect(stats[0].queueName).toBe('queue1');
      expect(stats[1].queueName).toBe('queue2');
    });
  });

  describe('pauseQueue', () => {
    it('should pause queue successfully', async () => {
      const mockQueue = { pause: jest.fn().mockResolvedValue() };
      queueService.queues.set('test-queue', mockQueue);

      await queueService.pauseQueue('test-queue');

      expect(mockQueue.pause).toHaveBeenCalled();
    });
  });

  describe('resumeQueue', () => {
    it('should resume queue successfully', async () => {
      const mockQueue = { resume: jest.fn().mockResolvedValue() };
      queueService.queues.set('test-queue', mockQueue);

      await queueService.resumeQueue('test-queue');

      expect(mockQueue.resume).toHaveBeenCalled();
    });
  });

  describe('clearQueue', () => {
    it('should clear queue successfully', async () => {
      const mockQueue = { drain: jest.fn().mockResolvedValue() };
      queueService.queues.set('test-queue', mockQueue);

      await queueService.clearQueue('test-queue');

      expect(mockQueue.drain).toHaveBeenCalled();
    });
  });

  describe('getFailedJobs', () => {
    it('should return failed jobs', async () => {
      const mockFailedJobs = [
        { id: 'job1', name: 'test-job-1', failedReason: 'Error 1' },
        { id: 'job2', name: 'test-job-2', failedReason: 'Error 2' }
      ];
      
      const mockQueue = {
        getFailed: jest.fn().mockResolvedValue(mockFailedJobs)
      };
      
      queueService.queues.set('test-queue', mockQueue);

      const failedJobs = await queueService.getFailedJobs('test-queue', 10);

      expect(mockQueue.getFailed).toHaveBeenCalledWith(0, 9);
      expect(failedJobs).toHaveLength(2);
      expect(failedJobs[0]).toEqual({
        id: 'job1',
        name: 'test-job-1',
        data: undefined,
        failedReason: 'Error 1',
        attemptsMade: undefined,
        timestamp: undefined,
        processedOn: undefined,
        finishedOn: undefined
      });
    });
  });

  describe('retryJob', () => {
    it('should retry job successfully', async () => {
      const mockJob = { retry: jest.fn().mockResolvedValue() };
      const mockQueue = {
        getJob: jest.fn().mockResolvedValue(mockJob)
      };
      
      queueService.queues.set('test-queue', mockQueue);

      const result = await queueService.retryJob('test-queue', 'job-123');

      expect(mockQueue.getJob).toHaveBeenCalledWith('job-123');
      expect(mockJob.retry).toHaveBeenCalled();
      expect(result).toBe(mockJob);
    });

    it('should throw error when job not found', async () => {
      const mockQueue = {
        getJob: jest.fn().mockResolvedValue(null)
      };
      
      queueService.queues.set('test-queue', mockQueue);

      await expect(queueService.retryJob('test-queue', 'non-existent')).rejects.toThrow('Job non-existent not found');
    });
  });

  describe('deleteJob', () => {
    it('should delete job successfully', async () => {
      const mockJob = { remove: jest.fn().mockResolvedValue() };
      const mockQueue = {
        getJob: jest.fn().mockResolvedValue(mockJob)
      };
      
      queueService.queues.set('test-queue', mockQueue);

      const result = await queueService.deleteJob('test-queue', 'job-123');

      expect(mockQueue.getJob).toHaveBeenCalledWith('job-123');
      expect(mockJob.remove).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when job not found', async () => {
      const mockQueue = {
        getJob: jest.fn().mockResolvedValue(null)
      };
      
      queueService.queues.set('test-queue', mockQueue);

      const result = await queueService.deleteJob('test-queue', 'non-existent');

      expect(result).toBe(false);
    });
  });

  describe('isRedisReady', () => {
    it('should return true when Redis is ready', () => {
      queueService.isReady = true;
      mockRedis.status = 'ready';

      expect(queueService.isRedisReady()).toBe(true);
    });

    it('should return false when Redis is not ready', () => {
      queueService.isReady = false;
      mockRedis.status = 'connecting';

      expect(queueService.isRedisReady()).toBe(false);
    });
  });

  describe('getConnectionStatus', () => {
    it('should return connection status', () => {
      queueService.isReady = true;
      queueService.queues.set('queue1', {});
      queueService.workers.set('worker1', {});

      const status = queueService.getConnectionStatus();

      expect(status).toEqual({
        status: 'ready',
        ready: true,
        host: 'localhost',
        port: 6379,
        db: 0,
        queueCount: 1,
        workerCount: 1
      });
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status', async () => {
      mockRedis.ping.mockResolvedValue('PONG');
      queueService.isReady = true;
      mockRedis.status = 'ready';

      const mockQueue = {
        getWaiting: jest.fn().mockResolvedValue([]),
        getActive: jest.fn().mockResolvedValue([]),
        getCompleted: jest.fn().mockResolvedValue([]),
        getFailed: jest.fn().mockResolvedValue([]),
        getDelayed: jest.fn().mockResolvedValue([])
      };
      
      queueService.queues.set('test-queue', mockQueue);

      const health = await queueService.healthCheck();

      expect(health.status).toBe('healthy');
      expect(health.redis.connected).toBe(true);
      expect(health.queues).toHaveLength(1);
    });

    it('should return unhealthy status on Redis error', async () => {
      mockRedis.ping.mockRejectedValue(new Error('Redis error'));

      const health = await queueService.healthCheck();

      expect(health.status).toBe('unhealthy');
      expect(health.error).toBe('Redis error');
    });
  });
});
