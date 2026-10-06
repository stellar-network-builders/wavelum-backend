/**
 * Unit tests for the retry/backoff, dead-letter-queue and stalled-job-detection
 * additions to QueueService. Redis (ioredis) and BullMQ are mocked so these run
 * without a live broker.
 */
jest.mock('ioredis');

const mockQueueInstances = {};
jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation((name) => {
      const instance = {
        name,
        add: jest.fn().mockResolvedValue({ id: 'job-1', name }),
        getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, delayed: 0, failed: 0 }),
        close: jest.fn().mockResolvedValue(),
      };
      mockQueueInstances[name] = instance;
      return instance;
    }),
    Worker: jest.fn().mockImplementation((name) => ({
      name,
      on: jest.fn(),
      close: jest.fn().mockResolvedValue(),
    })),
  };
});

const QueueService = require('./queueService');

describe('QueueService — retry / backoff', () => {
  let service;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new QueueService();
  });

  it('defaults to 5 attempts with exponential 1-minute base backoff', () => {
    const opts = service.getDefaultJobOptions();
    expect(opts.attempts).toBe(5);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 60000 });
  });

  it('produces the 1/2/4/8/16-minute schedule from the exponential base', () => {
    const { delay } = service.getDefaultJobOptions().backoff;
    // BullMQ: delay * 2 ** (attemptsMade - 1)
    const schedule = [1, 2, 3, 4, 5].map((n) => (delay * 2 ** (n - 1)) / 60000);
    expect(schedule).toEqual([1, 2, 4, 8, 16]);
  });

  it('allows per-job overrides while keeping defaults', () => {
    const opts = service.getDefaultJobOptions({ attempts: 2, priority: 9 });
    expect(opts.attempts).toBe(2);
    expect(opts.priority).toBe(9);
    expect(opts.backoff.type).toBe('exponential');
  });

  it('honours QUEUE_MAX_RETRIES / QUEUE_BACKOFF_DELAY env overrides via constructor opts', () => {
    const custom = new QueueService({ maxRetries: 8, backoffDelay: 1000 });
    const opts = custom.getDefaultJobOptions();
    expect(opts.attempts).toBe(8);
    expect(opts.backoff.delay).toBe(1000);
  });
});

describe('QueueService — stalled-job detection', () => {
  it('configures stalledInterval and maxStalledCount on workers by default', () => {
    const service = new QueueService();
    const opts = service.getDefaultWorkerOptions();
    expect(opts.stalledInterval).toBe(30000);
    expect(opts.maxStalledCount).toBe(2);
  });

  it('lets callers override worker concurrency without losing stalled config', () => {
    const service = new QueueService();
    const opts = service.getDefaultWorkerOptions({ concurrency: 10 });
    expect(opts.concurrency).toBe(10);
    expect(opts.stalledInterval).toBe(30000);
    expect(opts.maxStalledCount).toBe(2);
  });
});

describe('QueueService — dead-letter queues', () => {
  let service;
  beforeEach(() => {
    jest.clearAllMocks();
    service = new QueueService();
  });

  it('derives the DLQ name by suffixing -dlq', () => {
    expect(service.getDeadLetterQueueName('pdf-generation')).toBe('pdf-generation-dlq');
    expect(service.getDeadLetterQueueName('soroban-indexing')).toBe('soroban-indexing-dlq');
  });

  it('creates and tracks a dead-letter queue', () => {
    const dlq = service.createDeadLetterQueue('soroban-indexing');
    expect(dlq.name).toBe('soroban-indexing-dlq');
    expect(service.deadLetterQueues.has('soroban-indexing-dlq')).toBe(true);
  });

  it('moves a failed job to the DLQ preserving payload and failure context', async () => {
    const job = {
      id: 'orig-99',
      name: 'index-block',
      data: { block: 1234 },
      attemptsMade: 5,
    };
    await service.moveToDeadLetter('soroban-indexing', job, new Error('boom'));

    const dlq = mockQueueInstances['soroban-indexing-dlq'];
    expect(dlq.add).toHaveBeenCalledTimes(1);
    const [, payload, opts] = dlq.add.mock.calls[0];
    expect(payload.originalQueue).toBe('soroban-indexing');
    expect(payload.originalJobId).toBe('orig-99');
    expect(payload.data).toEqual({ block: 1234 });
    expect(payload.failedReason).toBe('boom');
    expect(payload.attemptsMade).toBe(5);
    expect(opts.attempts).toBe(1); // DLQ jobs are not retried
  });

  it('aggregates counts across all known dead-letter queues', async () => {
    service.createDeadLetterQueue('queue-a');
    service.createDeadLetterQueue('queue-b');
    mockQueueInstances['queue-a-dlq'].getJobCounts.mockResolvedValue({
      waiting: 2,
      active: 0,
      delayed: 1,
      failed: 3,
    });
    mockQueueInstances['queue-b-dlq'].getJobCounts.mockResolvedValue({
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
    });

    const counts = await service.getAllDeadLetterCounts();
    const a = counts.find((c) => c.queueName === 'queue-a-dlq');
    const b = counts.find((c) => c.queueName === 'queue-b-dlq');
    expect(a.total).toBe(6);
    expect(b.total).toBe(0);
  });
});
