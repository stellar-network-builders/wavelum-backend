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

const axios = require('axios');
const {
  OrganizationWebhook,
  ClaimWebhookDelivery,
  Beneficiary,
} = require('../models');
const {
  ClaimWebhookDispatcherService,
} = require('./claimWebhookDispatcherService');

describe('ClaimWebhookDispatcherService', () => {
  let service;
  let consoleLogSpy;
  let consoleWarnSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CLAIM_WEBHOOK_SIGNING_SECRET;
    delete process.env.CLAIM_WEBHOOK_ALLOW_INSECURE_HTTP;
    service = new ClaimWebhookDispatcherService();
    service.scheduleDelivery = jest.fn();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('queues deliveries for matching registered webhook endpoints', async () => {
    const update = jest.fn().mockResolvedValue(true);

    OrganizationWebhook.findAll.mockResolvedValue([
      {
        id: 'webhook-1',
        organization_id: 'org-1',
        webhook_url: 'https://client.example.com/webhooks/claims',
      },
    ]);
    ClaimWebhookDelivery.findOrCreate.mockResolvedValue([
      {
        id: 'delivery-1',
        delivery_status: 'pending',
        update,
      },
      true,
    ]);

    const result = await service.enqueueTokensClaimedEvent({
      event_id: 'event-1',
      user_address: 'GBENEFICIARY',
      amount_claimed: '25',
      claim_timestamp: '2026-04-22T00:00:00.000Z',
      transaction_hash: 'tx-123',
      block_number: 456,
      token_address: 'TOKEN-1',
      organization_id: 'org-1',
    });

    expect(result).toEqual({ endpoints: 1, queued: 1 });
    expect(OrganizationWebhook.findAll).toHaveBeenCalledWith({
      where: {
        organization_id: expect.any(Object),
      },
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        target_url: 'https://client.example.com/webhooks/claims',
        payload: expect.objectContaining({
          event: 'tokens_claimed',
          event_id: 'event-1',
          data: expect.objectContaining({
            beneficiary_address: 'GBENEFICIARY',
            amount: '25',
            transaction_hash: 'tx-123',
          }),
        }),
      })
    );
    expect(service.scheduleDelivery).toHaveBeenCalledWith('delivery-1');
  });

  it('does not queue duplicate deliveries that already succeeded', async () => {
    OrganizationWebhook.findAll.mockResolvedValue([
      {
        id: 'webhook-1',
        organization_id: 'org-1',
        webhook_url: 'https://client.example.com/webhooks/claims',
      },
    ]);
    ClaimWebhookDelivery.findOrCreate.mockResolvedValue([
      {
        id: 'delivery-1',
        delivery_status: 'success',
        update: jest.fn(),
      },
      false,
    ]);

    const result = await service.enqueueTokensClaimedEvent({
      event_id: 'event-1',
      user_address: 'GBENEFICIARY',
      amount_claimed: '25',
      claim_timestamp: '2026-04-22T00:00:00.000Z',
      transaction_hash: 'tx-123',
      block_number: 456,
      organization_id: 'org-1',
    });

    expect(result).toEqual({ endpoints: 1, queued: 0 });
    expect(service.scheduleDelivery).not.toHaveBeenCalled();
  });

  it('skips invalid webhook endpoints and records the validation error', async () => {
    const update = jest.fn().mockResolvedValue(true);

    OrganizationWebhook.findAll.mockResolvedValue([
      {
        id: 'webhook-1',
        organization_id: 'org-1',
        webhook_url: 'http://client.example.com/webhooks/claims',
      },
    ]);
    ClaimWebhookDelivery.findOrCreate.mockResolvedValue([
      {
        id: 'delivery-1',
        delivery_status: 'pending',
        update,
      },
      true,
    ]);

    const result = await service.enqueueTokensClaimedEvent({
      event_id: 'event-1',
      user_address: 'GBENEFICIARY',
      amount_claimed: '25',
      claim_timestamp: '2026-04-22T00:00:00.000Z',
      transaction_hash: 'tx-123',
      organization_id: 'org-1',
    });

    expect(result).toEqual({ endpoints: 1, queued: 0 });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_status: 'skipped',
        last_error_message: 'Unsupported webhook protocol: http:',
      })
    );
    expect(service.scheduleDelivery).not.toHaveBeenCalled();
  });

  it('resolves organizations from beneficiary vault relationships when organization_id is absent', async () => {
    const update = jest.fn().mockResolvedValue(true);

    Beneficiary.findAll.mockResolvedValue([
      {
        vault: {
          org_id: 'org-1',
        },
      },
      {
        vault: {
          org_id: 'org-1',
        },
      },
      {
        vault: {
          org_id: 'org-2',
        },
      },
    ]);
    OrganizationWebhook.findAll.mockResolvedValue([
      {
        id: 'webhook-1',
        organization_id: 'org-1',
        webhook_url: 'https://client.example.com/webhooks/claims',
      },
    ]);
    ClaimWebhookDelivery.findOrCreate.mockResolvedValue([
      {
        id: 'delivery-1',
        delivery_status: 'pending',
        update,
      },
      true,
    ]);

    const result = await service.enqueueTokensClaimedEvent({
      event_id: 'event-1',
      beneficiary_address: 'GBENEFICIARY',
      amount: '25',
      transaction_hash: 'tx-123',
      token_address: 'TOKEN-1',
      vault_address: 'VAULT-1',
      claim_timestamp: '2026-04-22T00:00:00.000Z',
    });

    expect(Beneficiary.findAll).toHaveBeenCalledWith({
      where: {
        address: 'GBENEFICIARY',
      },
      include: [
        expect.objectContaining({
          as: 'vault',
          required: true,
          where: expect.objectContaining({
            is_active: true,
            token_address: 'TOKEN-1',
            address: 'VAULT-1',
          }),
        }),
      ],
    });
    const organizationLookup =
      OrganizationWebhook.findAll.mock.calls[0][0].where.organization_id;
    const inOperator = Object.getOwnPropertySymbols(organizationLookup)[0];

    expect(organizationLookup[inOperator]).toEqual(['org-1', 'org-2']);
    expect(result).toEqual({ endpoints: 1, queued: 1 });
  });

  it('sends signed webhook payloads and marks successful deliveries', async () => {
    process.env.CLAIM_WEBHOOK_SIGNING_SECRET = 'top-secret';
    service = new ClaimWebhookDispatcherService();

    const update = jest.fn().mockResolvedValue(true);
    ClaimWebhookDelivery.findByPk.mockResolvedValue({
      id: 'delivery-1',
      event_key: 'event-1',
      delivery_status: 'pending',
      attempt_count: 0,
      target_url: 'https://client.example.com/webhooks/claims',
      payload_signature: 'signed-payload',
      payload: {
        event: 'tokens_claimed',
        event_id: 'event-1',
        confirmed_at: '2026-04-22T00:00:00.000Z',
        data: {
          beneficiary_address: 'GBENEFICIARY',
          amount: '25',
          transaction_hash: 'tx-123',
        },
      },
      update,
    });
    axios.post.mockResolvedValue({
      status: 200,
      data: { ok: true },
    });

    await service.processDelivery('delivery-1');

    expect(axios.post).toHaveBeenCalledWith(
      'https://client.example.com/webhooks/claims',
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Vesting-Event': 'tokens_claimed',
          'X-Vesting-Event-Id': 'event-1',
          'X-Vesting-Signature': 'signed-payload',
        }),
      })
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_status: 'success',
        attempt_count: 1,
        last_http_status: 200,
      })
    );
  });

  it('moves failed deliveries into retrying state and reschedules them', async () => {
    const update = jest.fn().mockResolvedValue(true);
    ClaimWebhookDelivery.findByPk.mockResolvedValue({
      id: 'delivery-1',
      event_key: 'event-1',
      delivery_status: 'pending',
      attempt_count: 0,
      target_url: 'https://client.example.com/webhooks/claims',
      payload_signature: null,
      payload: {
        event: 'tokens_claimed',
        event_id: 'event-1',
        confirmed_at: '2026-04-22T00:00:00.000Z',
        data: {
          beneficiary_address: 'GBENEFICIARY',
          amount: '25',
          transaction_hash: 'tx-123',
        },
      },
      update,
    });
    axios.post.mockRejectedValue(new Error('timeout'));

    await service.processDelivery('delivery-1');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_status: 'retrying',
        attempt_count: 1,
        last_error_message: 'timeout',
      })
    );
    expect(service.scheduleDelivery).toHaveBeenCalledWith(
      'delivery-1',
      service.calculateBackoffMs(1)
    );
  });

  it('marks a delivery as failed without rescheduling after the retry limit is exhausted', async () => {
    service.retryLimit = 2;

    const update = jest.fn().mockResolvedValue(true);
    ClaimWebhookDelivery.findByPk.mockResolvedValue({
      id: 'delivery-1',
      event_key: 'event-1',
      delivery_status: 'retrying',
      attempt_count: 1,
      target_url: 'https://client.example.com/webhooks/claims',
      payload_signature: null,
      payload: {
        event: 'tokens_claimed',
        event_id: 'event-1',
        confirmed_at: '2026-04-22T00:00:00.000Z',
        data: {
          beneficiary_address: 'GBENEFICIARY',
          amount: '25',
          transaction_hash: 'tx-123',
        },
      },
      update,
    });
    axios.post.mockResolvedValue({
      status: 500,
      data: { error: 'server error' },
    });

    await service.processDelivery('delivery-1');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        delivery_status: 'failed',
        attempt_count: 2,
        last_http_status: 500,
        last_response_body: JSON.stringify({ error: 'server error' }),
        next_attempt_at: null,
      })
    );
    expect(service.scheduleDelivery).not.toHaveBeenCalled();
  });

  it('resumes pending and retryable deliveries whose next attempt time is due', async () => {
    ClaimWebhookDelivery.findAll.mockResolvedValue([
      { id: 'delivery-1' },
      { id: 'delivery-2' },
    ]);

    await service.resumePendingDeliveries();

    expect(ClaimWebhookDelivery.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.any(Object),
        limit: 100,
        order: [['created_at', 'ASC']],
      })
    );
    expect(service.scheduleDelivery).toHaveBeenNthCalledWith(1, 'delivery-1');
    expect(service.scheduleDelivery).toHaveBeenNthCalledWith(2, 'delivery-2');
  });
});
