describe('ClaimWebhookListenerService', () => {
  let emitter;
  let dispatcher;
  let ClaimWebhookListenerService;
  let service;

  beforeEach(() => {
    jest.resetModules();
    emitter = new (require('events').EventEmitter)();
    dispatcher = {
      start: jest.fn(),
      stop: jest.fn(),
      enqueueTokensClaimedEvent: jest.fn().mockResolvedValue({ endpoints: 1, queued: 1 }),
    };

    jest.doMock('./indexingService', () => ({
      claimEventEmitter: emitter,
    }));

    jest.doMock('./claimWebhookDispatcherService', () => dispatcher);

    ({ ClaimWebhookListenerService } = require('./claimWebhookListenerService'));
    service = new ClaimWebhookListenerService(dispatcher);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('subscribes to confirmed tokens claimed events and queues dispatches', async () => {
    service.start();

    emitter.emit('tokensClaimed', {
      event_id: 'event-1',
      transaction_hash: 'tx-123',
    });

    await Promise.resolve();

    expect(dispatcher.start).toHaveBeenCalledTimes(1);
    expect(dispatcher.enqueueTokensClaimedEvent).toHaveBeenCalledWith({
      event_id: 'event-1',
      transaction_hash: 'tx-123',
    });
  });

  it('does not attach duplicate listeners on repeated start calls', () => {
    service.start();
    service.start();

    expect(dispatcher.start).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount('tokensClaimed')).toBe(1);
  });
});
