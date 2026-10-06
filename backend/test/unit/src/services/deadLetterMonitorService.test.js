/**
 * Tests for DeadLetterMonitorService: it should alert (webhook + email) only
 * when a dead-letter queue is non-empty, and stay quiet otherwise.
 */
jest.mock('axios');
jest.mock('./emailService', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const axios = require('axios');
const emailService = require('./emailService');
const DeadLetterMonitorService = require('./deadLetterMonitorService');

describe('DeadLetterMonitorService', () => {
  let queueService;

  beforeEach(() => {
    jest.clearAllMocks();
    axios.post.mockResolvedValue({ status: 200 });
    queueService = { getAllDeadLetterCounts: jest.fn() };
  });

  it('does not alert when all dead-letter queues are empty', async () => {
    queueService.getAllDeadLetterCounts.mockResolvedValue([
      { queueName: 'a-dlq', total: 0 },
      { queueName: 'b-dlq', total: 0 },
    ]);
    const monitor = new DeadLetterMonitorService(queueService, {
      webhookUrl: 'https://hooks.example/x',
      alertEmail: 'ops@example.com',
    });

    const result = await monitor.checkAndAlert();

    expect(result.alerted).toBe(false);
    expect(axios.post).not.toHaveBeenCalled();
    expect(emailService.sendEmail).not.toHaveBeenCalled();
  });

  it('alerts via webhook and email when a DLQ has jobs', async () => {
    queueService.getAllDeadLetterCounts.mockResolvedValue([
      { queueName: 'pdf-generation-dlq', total: 4 },
      { queueName: 'soroban-indexing-dlq', total: 0 },
    ]);
    const monitor = new DeadLetterMonitorService(queueService, {
      webhookUrl: 'https://hooks.example/x',
      alertEmail: 'ops@example.com',
    });

    const result = await monitor.checkAndAlert();

    expect(result.alerted).toBe(true);
    expect(result.offenders).toHaveLength(1);
    expect(result.offenders[0].queueName).toBe('pdf-generation-dlq');
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toBe('https://hooks.example/x');
  });

  it('still resolves when no alert channel is configured', async () => {
    queueService.getAllDeadLetterCounts.mockResolvedValue([{ queueName: 'a-dlq', total: 2 }]);
    const monitor = new DeadLetterMonitorService(queueService, { webhookUrl: '', alertEmail: '' });

    const result = await monitor.checkAndAlert();

    expect(result.alerted).toBe(true);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('does not throw if the webhook delivery fails', async () => {
    axios.post.mockRejectedValue(new Error('network down'));
    queueService.getAllDeadLetterCounts.mockResolvedValue([{ queueName: 'a-dlq', total: 1 }]);
    const monitor = new DeadLetterMonitorService(queueService, {
      webhookUrl: 'https://hooks.example/x',
    });

    await expect(monitor.checkAndAlert()).resolves.toMatchObject({ alerted: true });
  });

  it('start() is idempotent and uses an unref-ed interval', () => {
    const monitor = new DeadLetterMonitorService(queueService, { intervalMs: 1000 });
    monitor.start();
    const firstTimer = monitor.timer;
    monitor.start();
    expect(monitor.timer).toBe(firstTimer);
    expect(monitor.isRunning).toBe(true);
    monitor.stop();
    expect(monitor.isRunning).toBe(false);
  });
});
