const SorobanEventPollerService = require('./sorobanEventPollerService');
const SorobanRpcClient = require('./sorobanRpcClient');
const { SorobanEvent, IndexerState } = require('../models');
const sequelize = require('../database/connection');

// Mock dependencies
jest.mock('./sorobanRpcClient');
jest.mock('../models');
jest.mock('../database/connection');

describe('SorobanEventPollerService', () => {
  let service;
  let mockRpcClient;
  let mockSequelize;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock environment variables
    process.env.SOROBAN_RPC_URL = 'http://test-rpc-url';

    // Mock RPC client
    mockRpcClient = {
      healthCheck: jest.fn(),
      getLatestLedger: jest.fn(),
      callWithRetry: jest.fn()
    };
    SorobanRpcClient.mockImplementation(() => mockRpcClient);

    // Mock sequelize
    mockSequelize = {
      transaction: jest.fn(),
      Sequelize: {
        Op: {}
      }
    };
    sequelize.mockReturnValue(mockSequelize);

    // Create service instance
    service = new SorobanEventPollerService({
      pollInterval: 1000,
      batchSize: 10
    });
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(service.serviceName).toBe('soroban-event-poller');
      expect(service.pollInterval).toBe(1000);
      expect(service.batchSize).toBe(10);
      expect(service.maxRetries).toBe(3);
    });

    it('should throw error if RPC URL is not configured', () => {
      delete process.env.SOROBAN_RPC_URL;
      delete process.env.STELLAR_RPC_URL;

      expect(() => new SorobanEventPollerService()).toThrow(
        'SOROBAN_RPC_URL or STELLAR_RPC_URL environment variable is required'
      );
    });
  });

  describe('start', () => {
    it('should start successfully when RPC is healthy', async () => {
      mockRpcClient.healthCheck.mockResolvedValue(true);
      mockRpcClient.getLatestLedger.mockResolvedValue({ sequence: 1000 });
      IndexerState.findByPk.mockResolvedValue(null);
      IndexerState.findOrCreate.mockResolvedValue([{}, false]);

      // Mock setInterval
      const mockSetInterval = jest.spyOn(global, 'setInterval').mockImplementation(() => 123);

      await service.start();

      expect(mockRpcClient.healthCheck).toHaveBeenCalled();
      expect(service.isRunning).toBe(true);
      expect(mockSetInterval).toHaveBeenCalled();

      mockSetInterval.mockRestore();
    });

    it('should throw error when RPC is not healthy', async () => {
      mockRpcClient.healthCheck.mockResolvedValue(false);

      await expect(service.start()).rejects.toThrow('Soroban RPC endpoint is not healthy');
      expect(service.isRunning).toBe(false);
    });

    it('should not start if already running', async () => {
      service.isRunning = true;
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await service.start();

      expect(consoleSpy).toHaveBeenCalledWith('Soroban Event Poller Service is already running');
      expect(mockRpcClient.healthCheck).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('stop', () => {
    it('should stop successfully', () => {
      service.isRunning = true;
      service.intervalId = 123;
      const mockClearInterval = jest.spyOn(global, 'clearInterval').mockImplementation();

      service.stop();

      expect(service.isRunning).toBe(false);
      expect(service.intervalId).toBeNull();
      expect(mockClearInterval).toHaveBeenCalledWith(123);

      mockClearInterval.mockRestore();
    });

    it('should warn if not running', () => {
      service.isRunning = false;
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      service.stop();

      expect(consoleSpy).toHaveBeenCalledWith('Soroban Event Poller Service is not running');

      consoleSpy.mockRestore();
    });
  });

  describe('getLastProcessedLedger', () => {
    it('should return 0 when no state exists', async () => {
      IndexerState.findByPk.mockResolvedValue(null);

      const result = await service.getLastProcessedLedger();

      expect(result).toBe(0);
      expect(IndexerState.findByPk).toHaveBeenCalledWith(service.serviceName);
    });

    it('should return last processed ledger when state exists', async () => {
      const mockState = { last_ingested_ledger: 500 };
      IndexerState.findByPk.mockResolvedValue(mockState);

      const result = await service.getLastProcessedLedger();

      expect(result).toBe(500);
    });

    it('should throw error on database failure', async () => {
      IndexerState.findByPk.mockRejectedValue(new Error('Database error'));

      await expect(service.getLastProcessedLedger()).rejects.toThrow('Database error');
    });
  });

  describe('updateLastProcessedLedger', () => {
    it('should create new state when none exists', async () => {
      const mockState = { save: jest.fn() };
      IndexerState.findOrCreate.mockResolvedValue([mockState, true]);

      await service.updateLastProcessedLedger(1000);

      expect(IndexerState.findOrCreate).toHaveBeenCalledWith({
        where: { service_name: service.serviceName },
        defaults: { last_ingested_ledger: 1000 }
      });
      expect(mockState.save).not.toHaveBeenCalled();
    });

    it('should update existing state', async () => {
      const mockState = { save: jest.fn() };
      IndexerState.findOrCreate.mockResolvedValue([mockState, false]);

      await service.updateLastProcessedLedger(1000);

      expect(mockState.save).toHaveBeenCalled();
    });
  });

  describe('isRelevantEvent', () => {
    it('should return true for VestingScheduleCreated event', () => {
      const event = {
        type: 'contract_event',
        body: {
          topic: 'VestingScheduleCreated(...)',
          data: {}
        }
      };

      expect(service.isRelevantEvent(event)).toBe(true);
    });

    it('should return true for TokensClaimed event', () => {
      const event = {
        type: 'contract_event',
        body: {
          topic: 'TokensClaimed(...)',
          data: {}
        }
      };

      expect(service.isRelevantEvent(event)).toBe(true);
    });

    it('should return false for non-contract events', () => {
      const event = {
        type: 'system_event',
        body: {
          topic: 'VestingScheduleCreated(...)',
          data: {}
        }
      };

      expect(service.isRelevantEvent(event)).toBe(false);
    });

    it('should return false for events without required fields', () => {
      const event = {
        type: 'contract_event',
        body: {}
      };

      expect(service.isRelevantEvent(event)).toBe(false);
    });
  });

  describe('extractEventType', () => {
    it('should extract VestingScheduleCreated type', () => {
      const event = {
        body: {
          topic: 'VestingScheduleCreated(vault_id, beneficiary, amount)'
        }
      };

      expect(service.extractEventType(event)).toBe('VestingScheduleCreated');
    });

    it('should extract TokensClaimed type', () => {
      const event = {
        body: {
          topic: 'TokensClaimed(beneficiary, amount)'
        }
      };

      expect(service.extractEventType(event)).toBe('TokensClaimed');
    });

    it('should return Unknown for unrecognized events', () => {
      const event = {
        body: {
          topic: 'SomeOtherEvent(data)'
        }
      };

      expect(service.extractEventType(event)).toBe('Unknown');
    });
  });

  describe('storeEvent', () => {
    it('should store new event successfully', async () => {
      const event = {
        id: 'tx-hash-123',
        ledger: 1000,
        contractId: 'contract-address',
        timestamp: '2024-01-01T00:00:00Z',
        body: {
          topic: 'VestingScheduleCreated(...)',
          data: {}
        }
      };

      const mockEventRecord = { id: 'event-id', save: jest.fn() };
      SorobanEvent.findOne.mockResolvedValue(null);
      SorobanEvent.create.mockResolvedValue(mockEventRecord);

      const result = await service.storeEvent(event);

      expect(SorobanEvent.findOne).toHaveBeenCalledWith({
        where: {
          ledger_sequence: 1000,
          event_type: 'VestingScheduleCreated',
          transaction_hash: 'tx-hash-123'
        }
      });
      expect(SorobanEvent.create).toHaveBeenCalledWith({
        event_type: 'VestingScheduleCreated',
        contract_address: 'contract-address',
        transaction_hash: 'tx-hash-123',
        ledger_sequence: 1000,
        event_body: event,
        event_timestamp: expect.any(Date)
      });
      expect(result).toBe(mockEventRecord);
    });

    it('should return existing event if duplicate', async () => {
      const event = {
        id: 'tx-hash-123',
        ledger: 1000,
        body: {
          topic: 'VestingScheduleCreated(...)',
          data: {}
        }
      };

      const existingEvent = { id: 'existing-event-id' };
      SorobanEvent.findOne.mockResolvedValue(existingEvent);

      const result = await service.storeEvent(event);

      expect(SorobanEvent.create).not.toHaveBeenCalled();
      expect(result).toBe(existingEvent);
    });
  });

  describe('addContractAddress and removeContractAddress', () => {
    it('should add contract address to monitoring', () => {
      const address = 'new-contract-address';
      service.addContractAddress(address);

      expect(service.contractAddresses).toContain(address);
    });

    it('should not add duplicate contract address', () => {
      const address = 'contract-address';
      service.contractAddresses.push(address);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      service.addContractAddress(address);

      expect(service.contractAddresses.filter(a => a === address).length).toBe(1);
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should remove contract address from monitoring', () => {
      const address = 'contract-to-remove';
      service.contractAddresses.push(address);

      service.removeContractAddress(address);

      expect(service.contractAddresses).not.toContain(address);
    });

    it('should handle removing non-existent contract address', () => {
      const address = 'non-existent-address';

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      service.removeContractAddress(address);

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('getStatus', () => {
    it('should return correct status', () => {
      service.isRunning = true;
      service.startTime = Date.now() - 60000; // 1 minute ago
      service.lastPollTime = Date.now() - 30000; // 30 seconds ago

      const status = service.getStatus();

      expect(status).toEqual({
        isRunning: true,
        pollInterval: 1000,
        batchSize: 10,
        contractAddresses: [],
        uptime: expect.any(Number),
        lastPoll: service.lastPollTime,
        serviceName: 'soroban-event-poller'
      });
    });
  });
});
