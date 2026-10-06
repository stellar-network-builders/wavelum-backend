jest.mock('axios');
jest.mock('../models', () => ({
  OrganizationWebhook: {
    findAll: jest.fn(),
  },
  ClaimWebhookDelivery: {
    findOrCreate: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
  },
  Beneficiary: {
    findAll: jest.fn(),
  },
  Vault: {},
}));

const { EventEmitter } = require('events');
const mockClaimEventEmitter = new EventEmitter();

jest.mock('./indexingService', () => ({
  claimEventEmitter: mockClaimEventEmitter,
}));

const axios = require('axios');
const {
  OrganizationWebhook,
  ClaimWebhookDelivery,
  Beneficiary,
} = require('../models');
const {
  ClaimWebhookDispatcherService,
} = require('./claimWebhookDispatcherService');
const {
  ClaimWebhookListenerService,
} = require('./claimWebhookListenerService');

describe('Claim webhook dispatcher integration', () => {
  let dispatcher;
  let listener;
  let deliveriesById;
  let deliveriesByKey;
  let deliverySequence;
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  const flushAsync = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  const flushEventDispatch = async () => {
    await flushAsync();
    await jest.advanceTimersByTimeAsync(1);
    await flushAsync();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();

    deliveriesById = new Map();
    deliveriesByKey = new Map();
    deliverySequence = 0;

    dispatcher = new ClaimWebhookDispatcherService();
    listener = new ClaimWebhookListenerService(dispatcher);

    OrganizationWebhook.findAll.mockResolvedValue([
      {
        id: 'webhook-1',
        organization_id: 'org-1',
        webhook_url: 'https://client.example.com/webhooks/claims',
      },
    ]);
    Beneficiary.findAll.mockResolvedValue([]);
    ClaimWebhookDelivery.findAll.mockResolvedValue([]);
    ClaimWebhookDelivery.findOrCreate.mockImplementation(async ({ where, defaults }) => {
      const lookupKey = `${where.organization_webhook_id}:${where.event_key}`;
      const existing = deliveriesByKey.get(lookupKey);

      if (existing) {
        return [existing, false];
      }

      const delivery = {
        id: `delivery-${++deliverySequence}`,
        attempt_count: 0,
        created_at: new Date().toISOString(),
        ...defaults,
      };

      delivery.update = jest.fn().mockImplementation(async (attrs) => {
        Object.assign(delivery, attrs);
        return delivery;
      });

      deliveriesByKey.set(lookupKey, delivery);
      deliveriesById.set(delivery.id, delivery);
      return [delivery, true];
    });
    ClaimWebhookDelivery.findByPk.mockImplementation(async (id) => {
      const delivery = deliveriesById.get(id);
      return delivery || null;
    });

    axios.post.mockResolvedValue({
      status: 202,
      data: { accepted: true },
    });

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    listener.stop();
    mockClaimEventEmitter.removeAllListeners();
    jest.clearAllTimers();
    jest.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('dispatches a confirmed claim event from the listener through to webhook delivery', async () => {
    listener.start();

    mockClaimEventEmitter.emit('tokensClaimed', {
      event_id: 'event-1',
      user_address: 'GBENEFICIARY',
      amount_claimed: '2500',
      claim_timestamp: '2026-04-22T00:00:00.000Z',
      transaction_hash: 'tx-123',
      block_number: 456,
      token_address: 'TOKEN-1',
      vault_address: 'VAULT-1',
      organization_id: 'org-1',
    });

    await flushEventDispatch();

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post).toHaveBeenCalledWith(
      'https://client.example.com/webhooks/claims',
      expect.objectContaining({
        event: 'tokens_claimed',
        event_id: 'event-1',
        confirmed: true,
        data: expect.objectContaining({
          beneficiary_address: 'GBENEFICIARY',
          amount: '2500',
          transaction_hash: 'tx-123',
          block_number: 456,
        }),
      }),
      expect.objectContaining({
        timeout: dispatcher.timeoutMs,
      })
    );

    const persistedDelivery = deliveriesById.get('delivery-1');
    expect(persistedDelivery.delivery_status).toBe('success');
    expect(persistedDelivery.attempt_count).toBe(1);
    expect(persistedDelivery.last_http_status).toBe(202);
  });

  it('prevents duplicate sends for the same event and endpoint across repeated emissions', async () => {
    listener.start();

    const claimEvent = {
      event_id: 'event-duplicate',
      user_address: 'GBENEFICIARY',
      amount_claimed: '2500',
      claim_timestamp: '2026-04-22T00:00:00.000Z',
      transaction_hash: 'tx-duplicate',
      organization_id: 'org-1',
    };

    mockClaimEventEmitter.emit('tokensClaimed', claimEvent);
    await flushEventDispatch();

    mockClaimEventEmitter.emit('tokensClaimed', claimEvent);
    await flushEventDispatch();

    expect(ClaimWebhookDelivery.findOrCreate).toHaveBeenCalledTimes(2);
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(deliveriesById.get('delivery-1').delivery_status).toBe('success');
  });
});
