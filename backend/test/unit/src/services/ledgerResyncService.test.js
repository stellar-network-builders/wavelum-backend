const LedgerResyncService = require('./ledgerResyncService');
const SorobanRpcClient = require('./sorobanRpcClient');
const { SorobanEvent, IndexerState, ClaimsHistory, SubSchedule } = require('../models');
const sequelize = require('../database/connection');

// Mock dependencies
jest.mock('./sorobanRpcClient');
jest.mock('../models');
jest.mock('../database/connection');

describe('LedgerResyncService', () => {
  let resyncService;
  let mockRpcClient;
  let mockSequelize;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock environment variables
    process.env.SOROBAN_RPC_URL = 'http://test-rpc-url';

    // Mock RPC client
    mockRpcClient = {
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

    // Create resync service instance
    resyncService = new LedgerResyncService({
      finalityThreshold: 10,
      resyncBatchSize: 5,
      maxResyncDepth: 100,
      resyncDelay: 100
    });
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(resyncService.serviceName).toBe('ledger-resync-service');
      expect(resyncService.finalityThreshold).toBe(10);
      expect(resyncService.resyncBatchSize).toBe(5);
      expect(resyncService.maxResyncDepth).toBe(100);
      expect(resyncService.resyncDelay).toBe(100);
      expect(resyncService.isResyncing).toBe(false);
    });
  });

  describe('getNetworkState', () => {
    it('should get network state successfully', async () => {
      const mockLedger = {
        sequence: 1000,
        hash: 'test-hash',
        timestamp: '2024-01-01T00:00:00Z',
        protocolVersion: 20
      };

      mockRpcClient.getLatestLedger.mockResolvedValue(mockLedger);

      const networkState = await resyncService.getNetworkState();

      expect(networkState).toEqual({
        latestSequence: 1000,
        latestHash: 'test-hash',
        timestamp: '2024-01-01T00:00:00Z',
        protocolVersion: 20
      });
    });

    it('should throw error if RPC URL not configured', async () => {
      delete process.env.SOROBAN_RPC_URL;
      delete process.env.STELLAR_RPC_URL;

      await expect(resyncService.getNetworkState()).rejects.toThrow(
        'SOROBAN_RPC_URL or STELLAR_RPC_URL environment variable is required'
      );
    });
  });

  describe('calculateSafeStartSequence', () => {
    it('should calculate safe start sequence correctly', () => {
      const networkState = { latestSequence: 1000 };
      
      const safeSequence = resyncService.calculateSafeStartSequence(networkState);

      expect(safeSequence).toBe(990); // 1000 - 10 (finalityThreshold)
    });

    it('should not go below 1', () => {
      const networkState = { latestSequence: 5 };
      
      const safeSequence = resyncService.calculateSafeStartSequence(networkState);

      expect(safeSequence).toBe(1);
    });
  });

  describe('getCurrentDbState', () => {
    it('should get current database state', async () => {
      SorobanEvent.max.mockResolvedValue(1000);
      ClaimsHistory.max.mockResolvedValue(950);
      SubSchedule.max.mockResolvedValue(980);
      
      const mockIndexerStates = [
        { service_name: 'service1', last_ingested_ledger: 900 },
        { service_name: 'service2', last_ingested_ledger: 950 }
      ];
      IndexerState.findAll.mockResolvedValue(mockIndexerStates);

      const dbState = await resyncService.getCurrentDbState();

      expect(dbState).toEqual({
        maxSorobanEventSequence: 1000,
        maxClaimsHistorySequence: 950,
        maxSubScheduleSequence: 980,
        indexerStates: new Map([
          ['service1', 900],
          ['service2', 950]
        ])
      });
    });

    it('should handle null values correctly', async () => {
      SorobanEvent.max.mockResolvedValue(null);
      ClaimsHistory.max.mockResolvedValue(null);
      SubSchedule.max.mockResolvedValue(null);
      IndexerState.findAll.mockResolvedValue([]);

      const dbState = await resyncService.getCurrentDbState();

      expect(dbState).toEqual({
        maxSorobanEventSequence: 0,
        maxClaimsHistorySequence: 0,
        maxSubScheduleSequence: 0,
        indexerStates: new Map()
      });
    });
  });

  describe('calculateRollbackPlan', () => {
    it('should calculate rollback plan when rollback is needed', () => {
      const dbState = {
        maxSorobanEventSequence: 1000,
        maxClaimsHistorySequence: 950,
        maxSubScheduleSequence: 980,
        indexerStates: new Map()
      };
      const safeStartSequence = 950;

      const plan = resyncService.calculateRollbackPlan(dbState, safeStartSequence);

      expect(plan).toEqual({
        needsRollback: true,
        rollbackDepth: 50,
        targetSequence: 950,
        currentMaxSequence: 1000,
        affectedTables: expect.arrayContaining([
          expect.objectContaining({ table: 'soroban_events' }),
          expect.objectContaining({ table: 'sub_schedules' })
        ])
      });
    });

    it('should calculate rollback plan when no rollback is needed', () => {
      const dbState = {
        maxSorobanEventSequence: 950,
        maxClaimsHistorySequence: 945,
        maxSubScheduleSequence: 948,
        indexerStates: new Map()
      };
      const safeStartSequence = 950;

      const plan = resyncService.calculateRollbackPlan(dbState, safeStartSequence);

      expect(plan).toEqual({
        needsRollback: false,
        rollbackDepth: 0,
        targetSequence: 950,
        currentMaxSequence: 950,
        affectedTables: []
      });
    });
  });

  describe('executeRollback', () => {
    it('should execute rollback successfully', async () => {
      const rollbackPlan = {
        targetSequence: 950,
        affectedTables: [
          { table: 'soroban_events' },
          { table: 'claims_history' },
          { table: 'sub_schedules' }
        ]
      };

      const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
      mockSequelize.transaction.mockResolvedValue(mockTransaction);

      SorobanEvent.destroy.mockResolvedValue(10);
      ClaimsHistory.destroy.mockResolvedValue(5);
      SubSchedule.destroy.mockResolvedValue(2);
      IndexerState.update.mockResolvedValue([1]);

      const result = await resyncService.executeRollback(rollbackPlan, 'test_resync');

      expect(SorobanEvent.destroy).toHaveBeenCalledWith({
        where: {
          ledger_sequence: {
            [mockSequelize.Sequelize.Op.gt]: 950
          }
        },
        transaction: mockTransaction
      });
      expect(ClaimsHistory.destroy).toHaveBeenCalledWith({
        where: {
          block_number: {
            [mockSequelize.Sequelize.Op.gt]: 950
          }
        },
        transaction: mockTransaction
      });
      expect(SubSchedule.destroy).toHaveBeenCalledWith({
        where: {
          block_number: {
            [mockSequelize.Sequelize.Op.gt]: 950
          }
        },
        transaction: mockTransaction
      });
      expect(mockTransaction.commit).toHaveBeenCalled();
      expect(mockTransaction.rollback).not.toHaveBeenCalled();

      expect(result).toEqual({
        success: true,
        totalDeleted: 17,
        deletedEvents: 10,
        deletedClaims: 5,
        deletedSchedules: 2,
        newHead: 950
      });
    });

    it('should rollback transaction on error', async () => {
      const rollbackPlan = {
        targetSequence: 950,
        affectedTables: []
      };

      const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
      mockSequelize.transaction.mockResolvedValue(mockTransaction);

      SorobanEvent.destroy.mockRejectedValue(new Error('Database error'));

      await expect(resyncService.executeRollback(rollbackPlan, 'test_resync')).rejects.toThrow('Database error');
      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
    });
  });

  describe('processResyncBatch', () => {
    it('should process batch successfully', async () => {
      const mockEvents = [
        { id: 'event1', ledger: 950, body: { topic: 'VestingScheduleCreated(...)' } },
        { id: 'event2', ledger: 951, body: { topic: 'TokensClaimed(...)' } }
      ];

      mockRpcClient.callWithRetry.mockResolvedValue({
        events: mockEvents
      });

      SorobanEvent.findOne.mockResolvedValue(null); // No duplicates
      SorobanEvent.create.mockResolvedValue({});

      const result = await resyncService.processResyncBatch(
        mockRpcClient,
        950,
        951,
        'test_resync'
      );

      expect(result).toEqual({
        success: true,
        eventsProcessed: 2,
        totalEvents: 2
      });
      expect(SorobanEvent.create).toHaveBeenCalledTimes(2);
    });

    it('should skip irrelevant events', async () => {
      const mockEvents = [
        { id: 'event1', ledger: 950, body: { topic: 'OtherEvent(...)' } },
        { id: 'event2', ledger: 951, body: { topic: 'VestingScheduleCreated(...)' } }
      ];

      mockRpcClient.callWithRetry.mockResolvedValue({
        events: mockEvents
      });

      SorobanEvent.findOne.mockResolvedValue(null);
      SorobanEvent.create.mockResolvedValue({});

      const result = await resyncService.processResyncBatch(
        mockRpcClient,
        950,
        951,
        'test_resync'
      );

      expect(result.eventsProcessed).toBe(1);
      expect(SorobanEvent.create).toHaveBeenCalledTimes(1);
    });

    it('should skip duplicate events', async () => {
      const mockEvents = [
        { id: 'event1', ledger: 950, body: { topic: 'VestingScheduleCreated(...)' } }
      ];

      mockRpcClient.callWithRetry.mockResolvedValue({
        events: mockEvents
      });

      SorobanEvent.findOne.mockResolvedValue({ id: 'existing-event' }); // Duplicate found

      const result = await resyncService.processResyncBatch(
        mockRpcClient,
        950,
        951,
        'test_resync'
      );

      expect(result.eventsProcessed).toBe(0);
      expect(SorobanEvent.create).not.toHaveBeenCalled();
    });
  });

  describe('executeResync', () => {
    it('should execute resync successfully', async () => {
      const mockEvents = [
        { id: 'event1', ledger: 950, body: { topic: 'VestingScheduleCreated(...)' } }
      ];

      mockRpcClient.callWithRetry.mockResolvedValue({
        events: mockEvents
      });

      SorobanEvent.findOne.mockResolvedValue(null);
      SorobanEvent.create.mockResolvedValue({});

      // Mock processResyncBatch
      jest.spyOn(resyncService, 'processResyncBatch').mockResolvedValue({
        success: true,
        eventsProcessed: 1,
        totalEvents: 1
      });

      const result = await resyncService.executeResync(950, 954, 'test_resync');

      expect(result).toEqual({
        success: true,
        totalEventsProcessed: 2, // 2 batches (950-954 with batch size 5)
        totalBatches: 2,
        errors: [],
        startSequence: 950,
        endSequence: 954
      });
    });
  });

  describe('performTargetedResync', () => {
    it('should perform targeted resync successfully', async () => {
      // Mock rollbackTargetRange
      jest.spyOn(resyncService, 'rollbackTargetRange').mockResolvedValue({
        success: true,
        deletedEvents: 5,
        deletedClaims: 2,
        deletedSchedules: 1
      });

      // Mock executeResync
      jest.spyOn(resyncService, 'executeResync').mockResolvedValue({
        success: true,
        totalEventsProcessed: 10,
        totalBatches: 2,
        errors: []
      });

      const result = await resyncService.performTargetedResync(950, 960);

      expect(result).toEqual({
        resyncId: expect.stringMatching(/^targeted_resync_/),
        duration: expect.any(Number),
        startSequence: 950,
        endSequence: 960,
        resyncResult: {
          success: true,
          totalEventsProcessed: 10,
          totalBatches: 2,
          errors: []
        }
      });

      expect(resyncService.rollbackTargetRange).toHaveBeenCalledWith(950, 960, expect.any(String));
      expect(resyncService.executeResync).toHaveBeenCalledWith(950, 960, expect.any(String));
    });

    it('should throw error if resync already in progress', async () => {
      resyncService.isResyncing = true;

      await expect(resyncService.performTargetedResync(950, 960)).rejects.toThrow(
        'Resync already in progress'
      );
    });
  });

  describe('rollbackTargetRange', () => {
    it('should rollback target range successfully', async () => {
      const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
      mockSequelize.transaction.mockResolvedValue(mockTransaction);

      SorobanEvent.destroy.mockResolvedValue(5);
      ClaimsHistory.destroy.mockResolvedValue(2);
      SubSchedule.destroy.mockResolvedValue(1);

      const result = await resyncService.rollbackTargetRange(950, 960, 'test_resync');

      expect(SorobanEvent.destroy).toHaveBeenCalledWith({
        where: {
          ledger_sequence: {
            [mockSequelize.Sequelize.Op.between]: [950, 960]
          }
        },
        transaction: mockTransaction
      });
      expect(ClaimsHistory.destroy).toHaveBeenCalledWith({
        where: {
          block_number: {
            [mockSequelize.Sequelize.Op.between]: [950, 960]
          }
        },
        transaction: mockTransaction
      });
      expect(SubSchedule.destroy).toHaveBeenCalledWith({
        where: {
          block_number: {
            [mockSequelize.Sequelize.Op.between]: [950, 960]
          }
        },
        transaction: mockTransaction
      });
      expect(mockTransaction.commit).toHaveBeenCalled();

      expect(result).toEqual({
        success: true,
        deletedEvents: 5,
        deletedClaims: 2,
        deletedSchedules: 1
      });
    });
  });

  describe('validateLedgerIntegrity', () => {
    it('should validate integrity successfully', async () => {
      // Mock getNetworkState
      jest.spyOn(resyncService, 'getNetworkState').mockResolvedValue({
        latestSequence: 1000
      });

      // Mock getCurrentDbState
      jest.spyOn(resyncService, 'getCurrentDbState').mockResolvedValue({
        maxSorobanEventSequence: 990,
        maxClaimsHistorySequence: 985,
        maxSubScheduleSequence: 988
      });

      const result = await resyncService.validateLedgerIntegrity();

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect database ahead of network', async () => {
      jest.spyOn(resyncService, 'getNetworkState').mockResolvedValue({
        latestSequence: 950
      });

      jest.spyOn(resyncService, 'getCurrentDbState').mockResolvedValue({
        maxSorobanEventSequence: 1000,
        maxClaimsHistorySequence: 950,
        maxSubScheduleSequence: 980
      });

      const result = await resyncService.validateLedgerIntegrity();

      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('DATABASE_AHEAD_OF_NETWORK');
      expect(result.issues[0].severity).toBe('HIGH');
    });

    it('should detect large sync gap', async () => {
      jest.spyOn(resyncService, 'getNetworkState').mockResolvedValue({
        latestSequence: 1200
      });

      jest.spyOn(resyncService, 'getCurrentDbState').mockResolvedValue({
        maxSorobanEventSequence: 950,
        maxClaimsHistorySequence: 945,
        maxSubScheduleSequence: 948
      });

      const result = await resyncService.validateLedgerIntegrity();

      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('LARGE_SYNC_GAP');
      expect(result.issues[0].severity).toBe('MEDIUM');
      expect(result.issues[0].data.gap).toBe(250);
    });
  });

  describe('getResyncProgress', () => {
    it('should return current resync progress', () => {
      const mockProgress = {
        resyncId: 'test_resync',
        status: 'IN_PROGRESS',
        progress: 50
      };
      resyncService.resyncProgress = mockProgress;

      const progress = resyncService.getResyncProgress();

      expect(progress).toBe(mockProgress);
    });

    it('should return null when no resync in progress', () => {
      resyncService.resyncProgress = null;

      const progress = resyncService.getResyncProgress();

      expect(progress).toBeNull();
    });
  });

  describe('cancelResync', () => {
    it('should cancel ongoing resync', () => {
      resyncService.isResyncing = true;
      resyncService.resyncProgress = {
        resyncId: 'test_resync',
        status: 'IN_PROGRESS'
      };

      const cancelled = resyncService.cancelResync();

      expect(cancelled).toBe(true);
      expect(resyncService.isResyncing).toBe(false);
      expect(resyncService.resyncProgress.status).toBe('CANCELLED');
    });

    it('should return false when no resync in progress', () => {
      resyncService.isResyncing = false;

      const cancelled = resyncService.cancelResync();

      expect(cancelled).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('should return correct status', () => {
      resyncService.isResyncing = true;
      resyncService.resyncProgress = {
        resyncId: 'test_resync',
        status: 'IN_PROGRESS'
      };

      const status = resyncService.getStatus();

      expect(status).toEqual({
        isResyncing: true,
        resyncProgress: resyncService.resyncProgress,
        finalityThreshold: 10,
        resyncBatchSize: 5,
        maxResyncDepth: 100,
        resyncDelay: 100
      });
    });
  });

  describe('extractEventType', () => {
    it('should extract VestingScheduleCreated type', () => {
      const event = {
        body: {
          topic: 'VestingScheduleCreated(vault_id, beneficiary, amount)'
        }
      };

      const eventType = resyncService.extractEventType(event);

      expect(eventType).toBe('VestingScheduleCreated');
    });

    it('should extract TokensClaimed type', () => {
      const event = {
        body: {
          topic: 'TokensClaimed(beneficiary, amount)'
        }
      };

      const eventType = resyncService.extractEventType(event);

      expect(eventType).toBe('TokensClaimed');
    });

    it('should return Unknown for unrecognized events', () => {
      const event = {
        body: {
          topic: 'SomeOtherEvent(data)'
        }
      };

      const eventType = resyncService.extractEventType(event);

      expect(eventType).toBe('Unknown');
    });
  });

  describe('isRelevantEvent', () => {
    it('should return true for relevant events', () => {
      expect(resyncService.isRelevantEvent('VestingScheduleCreated')).toBe(true);
      expect(resyncService.isRelevantEvent('TokensClaimed')).toBe(true);
    });

    it('should return false for irrelevant events', () => {
      expect(resyncService.isRelevantEvent('Unknown')).toBe(false);
      expect(resyncService.isRelevantEvent('OtherEvent')).toBe(false);
    });
  });
});
