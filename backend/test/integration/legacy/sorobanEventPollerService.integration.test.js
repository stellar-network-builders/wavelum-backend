jest.mock('../src/services/rpcQueueService', () => {
  return jest.fn().mockImplementation(() => {
    return {
      start: jest.fn().mockResolvedValue(true),
      stop: jest.fn().mockResolvedValue(true),
      addRpcJob: jest.fn()
    };
  });
});

jest.mock('../src/models', () => {
  const events = [];
  let state = { last_ingested_ledger: 0 };
  
  return {
    SorobanEvent: {
      findAll: jest.fn().mockImplementation(() => {
        return Promise.resolve(events);
      }),
      findOne: jest.fn().mockImplementation(({ where }) => Promise.resolve(events.find(e => e.transaction_hash === where.transaction_hash))),
      create: jest.fn().mockImplementation((data) => {
        events.push(data);
        return Promise.resolve(data);
      }),
      destroy: jest.fn().mockImplementation(() => {
        events.length = 0;
        return Promise.resolve(true);
      }),
      update: jest.fn().mockResolvedValue([1])
    },
    IndexerState: {
      findByPk: jest.fn().mockImplementation(() => Promise.resolve(state)),
      findOrCreate: jest.fn().mockImplementation(({ defaults }) => {
        state.last_ingested_ledger = defaults.last_ingested_ledger;
        return Promise.resolve([state, true]);
      }),
      destroy: jest.fn().mockImplementation(() => {
        state.last_ingested_ledger = 0;
        return Promise.resolve(true);
      })
    },
    sequelize: {
      sync: jest.fn().mockResolvedValue(true)
    }
  };
});

const SorobanEventPollerService = require('../src/services/sorobanEventPollerService');
const SorobanMockServer = require('./helpers/sorobanMockServer');
const validVestingEvent = require('./fixtures/soroban/validVestingCreateEvent.json');
const validClaimEvent = require('./fixtures/soroban/validClaimEvent.json');
const { SorobanEvent, IndexerState } = require('../src/models');



describe('SorobanEventPollerService Integration Tests', () => {
  const rpcUrl = 'http://localhost:8080';
  let mockServer;
  let service;

  beforeEach(async () => {
    const RpcQueueService = require('../src/services/rpcQueueService');
    RpcQueueService.mockImplementation(() => {
      return {
        start: jest.fn().mockResolvedValue(true),
        stop: jest.fn().mockResolvedValue(true),
        addRpcJob: jest.fn()
      };
    });

    mockServer = new SorobanMockServer(rpcUrl);
    process.env.SOROBAN_RPC_URL = rpcUrl;
    
    if (SorobanEvent) await SorobanEvent.destroy({ truncate: true, cascade: true });
    if (IndexerState) await IndexerState.destroy({ truncate: true, cascade: true });

    service = new SorobanEventPollerService({
      pollInterval: 10000,
      batchSize: 100,
      rpcTimeout: 1000,
      maxRetries: 1
    });
    
    // Spy on external dependencies to avoid real network/db operations that might be missing
    jest.spyOn(service.reorgDetector, 'start').mockResolvedValue();
    jest.spyOn(service.reorgDetector, 'triggerCheck').mockResolvedValue({ issues: [] });
    jest.spyOn(service.rpcQueueService, 'start').mockResolvedValue();
    jest.spyOn(service.rpcQueueService, 'stop').mockResolvedValue();
  });

  afterEach(async () => {
    await service.stop();
    mockServer.clear();
    jest.restoreAllMocks();
  });

  it('Seeds mock events at known ledger sequences and validates processing', async () => {
    mockServer.mockGetLatestLedger(123460);
    
    // Seed the database so the poller starts right before our events
    await IndexerState.findOrCreate({
      where: { service_name: service.serviceName },
      defaults: { last_ingested_ledger: 123455, status: 'active' }
    });
    
    // Use Object.assign to mutate the existing object instead of replacing it
    Object.assign(service.rpcQueueService, {
      start: jest.fn().mockResolvedValue(true),
      stop: jest.fn().mockResolvedValue(true),
      addRpcJob: jest.fn().mockResolvedValue({
        finished: async () => ({ success: true, result: { events: [validVestingEvent, validClaimEvent] } })
      })
    });
    
    await service.start();
    
    const events = await SorobanEvent.findAll();
    expect(events.length).toBe(2);
    
    const vestingEvent = events.find(e => e.event_type === 'VestingScheduleCreated');
    expect(vestingEvent).toBeDefined();
    expect(vestingEvent.ledger_sequence).toBe(123456);
    
    const state = await IndexerState.findByPk(service.serviceName);
    expect(state.last_ingested_ledger).toBe(123460);
  });

  it('Verifies event deduplication (same event ID processed twice)', async () => {
    await service.processEvents([validVestingEvent], 'poll_1');
    await service.processEvents([validVestingEvent], 'poll_2');
    
    const events = await SorobanEvent.findAll();
    expect(events.length).toBe(1);
  });

  it('Tests reorg detection via ledgerReorgDetector.js', async () => {
    mockServer.mockGetHealth();
    mockServer.mockGetLatestLedger(123460);
    
    jest.spyOn(service.reorgDetector, 'triggerCheck').mockResolvedValue({ issues: [{ type: 'reorg', ledger: 123450 }] });
    const processEventsSpy = jest.spyOn(service, 'processEvents');
    
    await service.pollEvents();
    expect(processEventsSpy).not.toHaveBeenCalled();
  });
});
