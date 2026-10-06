/**
 * Tests for BackgroundJobManager: dead-letter routing once retries are
 * exhausted, job producers, job-status lookup and aggregate status. The
 * underlying QueueService and DeadLetterMonitorService are mocked.
 */
jest.mock('../services/queueService');
jest.mock('../services/deadLetterMonitorService');

const QueueService = require('../services/queueService');
const DeadLetterMonitorService = require('../services/deadLetterMonitorService');

// Build a controllable mock QueueService used by the singleton under test.
const workerHandlers = {};
const mockQueue = { getJob: jest.fn() };
const mockQueueService = {
  connect: jest.fn().mockResolvedValue(),
  disconnect: jest.fn().mockResolvedValue(),
  getQueue: jest.fn().mockReturnValue(mockQueue),
  createDeadLetterQueue: jest.fn(),
  getWorker: jest.fn().mockImplementation((name) => ({
    name,
    on: jest.fn((event, cb) => {
      workerHandlers[`${name}:${event}`] = cb;
    }),
  })),
  moveToDeadLetter: jest.fn().mockResolvedValue(),
  addJob: jest.fn().mockResolvedValue({ id: 'job-123' }),
  getAllQueueStats: jest.fn().mockResolvedValue([]),
  getAllDeadLetterCounts: jest.fn().mockResolvedValue([]),
  getConnectionStatus: jest.fn().mockReturnValue({ status: 'ready' }),
  defaultMaxRetries: 5,
};

QueueService.mockImplementation(() => mockQueueService);
DeadLetterMonitorService.mockImplementation(() => ({
  start: jest.fn(),
  stop: jest.fn(),
  isRunning: false,
  lastAlertAt: null,
}));

const manager = require('./backgroundJobManager');

describe('BackgroundJobManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('addAnnualStatementJob', () => {
    it('enqueues onto the annual-statement queue with the statement data and year', async () => {
      await manager.addAnnualStatementJob({ foo: 'bar' }, 2024);
      expect(mockQueueService.addJob).toHaveBeenCalledWith(
        'annual-statement',
        'generate-annual-statement',
        { statementData: { foo: 'bar' }, year: 2024 }
      );
    });
  });

  describe('addHeavyComputationJob', () => {
    it('enqueues onto the heavy-computation queue', async () => {
      await manager.addHeavyComputationJob('CSV', { vaultId: 7 });
      expect(mockQueueService.addJob).toHaveBeenCalledWith('heavy-computation', 'CSV', {
        type: 'CSV',
        vaultId: 7,
      });
    });
  });

  describe('registerWorker — DLQ routing', () => {
    it('routes a job to the DLQ once attempts are exhausted', async () => {
      manager.registerWorker('annual-statement', jest.fn());
      const onFailed = workerHandlers['annual-statement:failed'];
      expect(onFailed).toBeInstanceOf(Function);

      const job = { id: 'j1', name: 'generate-annual-statement', attemptsMade: 5, opts: { attempts: 5 } };
      await onFailed(job, new Error('render failed'));

      expect(mockQueueService.moveToDeadLetter).toHaveBeenCalledWith(
        'annual-statement',
        job,
        expect.any(Error)
      );
    });

    it('does NOT route to the DLQ while retries remain', async () => {
      manager.registerWorker('heavy-computation', jest.fn());
      const onFailed = workerHandlers['heavy-computation:failed'];

      const job = { id: 'j2', name: 'CSV', attemptsMade: 2, opts: { attempts: 5 } };
      await onFailed(job, new Error('transient'));

      expect(mockQueueService.moveToDeadLetter).not.toHaveBeenCalled();
    });
  });

  describe('getJobStatus', () => {
    it('returns status for a job found in a managed queue', async () => {
      mockQueue.getJob.mockResolvedValueOnce({
        id: 'abc',
        getState: jest.fn().mockResolvedValue('completed'),
        progress: 100,
        attemptsMade: 1,
        returnvalue: { ok: true },
      });

      const status = await manager.getJobStatus('abc');
      expect(status).toMatchObject({ id: 'abc', state: 'completed', progress: 100 });
    });

    it('returns null when no queue has the job', async () => {
      mockQueue.getJob.mockResolvedValue(null);
      const status = await manager.getJobStatus('missing');
      expect(status).toBeNull();
    });
  });

  describe('processHeavyComputation', () => {
    it('throws on an unknown job type (so it retries / routes to DLQ)', async () => {
      await expect(
        manager.processHeavyComputation({ id: 'x', data: { type: 'UNKNOWN' } })
      ).rejects.toThrow(/Unknown heavy-computation job type/);
    });
  });

  describe('getQueuesStatus', () => {
    it('aggregates queue stats and dead-letter counts', async () => {
      mockQueueService.getAllQueueStats.mockResolvedValue([{ queueName: 'annual-statement', total: 3 }]);
      mockQueueService.getAllDeadLetterCounts.mockResolvedValue([
        { queueName: 'annual-statement-dlq', total: 1 },
      ]);

      const status = await manager.getQueuesStatus();
      expect(status.queues).toHaveLength(1);
      expect(status.deadLetterQueues[0].queueName).toBe('annual-statement-dlq');
      expect(status.connection).toEqual({ status: 'ready' });
    });
  });
});
