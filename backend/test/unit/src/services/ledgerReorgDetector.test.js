const LedgerReorgDetector = require('./ledgerReorgDetector');
const SorobanRpcClient = require('./sorobanRpcClient');
const { SorobanEvent, IndexerState } = require('../models');
const sequelize = require('../database/connection');

// Mock dependencies
jest.mock('./sorobanRpcClient');
jest.mock('../models');
jest.mock('../database/connection');

describe('LedgerReorgDetector', () => {
  let detector;
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
      call: jest.fn(),
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

    // Create detector instance
    detector = new LedgerReorgDetector({
      maxReorgDepth: 50,
      finalityThreshold: 10,
      checkInterval: 5000
    });
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(detector.serviceName).toBe('ledger-reorg-detector');
      expect(detector.maxReorgDepth).toBe(50);
      expect(detector.finalityThreshold).toBe(10);
      expect(detector.gapDetectionThreshold).toBe(3);
      expect(detector.checkInterval).toBe(5000);
      expect(detector.isRunning).toBe(false);
    });
  });

  describe('start', () => {
    it('should start successfully', async () => {
      mockRpcClient.getLatestLedger.mockResolvedValue({
        sequence: 1000,
        hash: 'test-hash',
        timestamp: '2024-01-01T00:00:00Z'
      });

      IndexerState.findByPk.mockResolvedValue(null);

      // Mock setInterval
      const mockSetInterval = jest.spyOn(global, 'setInterval').mockImplementation(() => 123);

      await detector.start();

      expect(detector.isRunning).toBe(true);
      expect(mockSetInterval).toHaveBeenCalled();

      mockSetInterval.mockRestore();
    });

    it('should not start if already running', async () => {
      detector.isRunning = true;
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await detector.start();

      expect(consoleSpy).toHaveBeenCalledWith('Ledger Reorg Detector is already running');
      expect(mockRpcClient.getLatestLedger).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('stop', () => {
    it('should stop successfully', () => {
      detector.isRunning = true;
      detector.intervalId = 123;
      const mockClearInterval = jest.spyOn(global, 'clearInterval').mockImplementation();

      detector.stop();

      expect(detector.isRunning).toBe(false);
      expect(detector.intervalId).toBeNull();
      expect(mockClearInterval).toHaveBeenCalledWith(123);

      mockClearInterval.mockRestore();
    });

    it('should warn if not running', () => {
      detector.isRunning = false;
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      detector.stop();

      expect(consoleSpy).toHaveBeenCalledWith('Ledger Reorg Detector is not running');

      consoleSpy.mockRestore();
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
      mockRpcClient.call.mockResolvedValue({ hash: 'ledger-hash' });

      const networkState = await detector.getNetworkState();

      expect(networkState).toEqual({
        latestSequence: 1000,
        latestHash: 'test-hash',
        timestamp: '2024-01-01T00:00:00Z',
        ledgerHashes: expect.any(Map)
      });
    });

    it('should throw error if RPC URL not configured', async () => {
      delete process.env.SOROBAN_RPC_URL;
      delete process.env.STELLAR_RPC_URL;

      await expect(detector.getNetworkState()).rejects.toThrow(
        'SOROBAN_RPC_URL or STELLAR_RPC_URL environment variable is required'
      );
    });
  });

  describe('detectLedgerGaps', () => {
    it('should detect rollback when network is behind', async () => {
      const networkState = { latestSequence: 950 };
      const lastProcessedLedger = 1000;

      const issues = await detector.detectLedgerGaps(networkState, lastProcessedLedger);

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('ROLLBACK_DETECTED');
      expect(issues[0].severity).toBe('HIGH');
      expect(issues[0].data.gap).toBe(50);
    });

    it('should detect large gaps', async () => {
      const networkState = { latestSequence: 1100 };
      const lastProcessedLedger = 1000;

      const issues = await detector.detectLedgerGaps(networkState, lastProcessedLedger);

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('LEDGER_GAP');
      expect(issues[0].severity).toBe('MEDIUM');
      expect(issues[0].data.gap).toBe(100);
    });

    it('should not detect issues for normal operation', async () => {
      const networkState = { latestSequence: 1005 };
      const lastProcessedLedger = 1000;

      const issues = await detector.detectLedgerGaps(networkState, lastProcessedLedger);

      expect(issues).toHaveLength(0);
    });
  });

  describe('detectForks', () => {
    it('should detect forks when hashes differ', async () => {
      // Setup cache with different hash
      detector.ledgerHashes.set(1000, 'cached-hash');
      
      const networkState = {
        ledgerHashes: new Map([[1000, 'network-hash']])
      };

      const issues = await detector.detectForks(networkState);

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('FORK_DETECTED');
      expect(issues[0].severity).toBe('HIGH');
      expect(issues[0].data.sequence).toBe(1000);
      expect(issues[0].data.cachedHash).toBe('cached-hash');
      expect(issues[0].data.networkHash).toBe('network-hash');
    });

    it('should not detect forks when hashes match', async () => {
      detector.ledgerHashes.set(1000, 'same-hash');
      
      const networkState = {
        ledgerHashes: new Map([[1000, 'same-hash']])
      };

      const issues = await detector.detectForks(networkState);

      expect(issues).toHaveLength(0);
    });
  });

  describe('detectSequenceInconsistencies', () => {
    it('should detect duplicate sequences', async () => {
      const mockEvents = [
        { ledger_sequence: 1000 },
        { ledger_sequence: 1001 },
        { ledger_sequence: 1000 }, // Duplicate
        { ledger_sequence: 1002 }
      ];

      SorobanEvent.findAll.mockResolvedValue(mockEvents);

      const networkState = {};
      const issues = await detector.detectSequenceInconsistencies(networkState, 900);

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('DUPLICATE_SEQUENCE');
      expect(issues[0].data.sequence).toBe(1000);
    });

    it('should detect out-of-order sequences', async () => {
      const mockEvents = [
        { ledger_sequence: 1000 },
        { ledger_sequence: 1002 },
        { ledger_sequence: 1001 }, // Out of order
        { ledger_sequence: 1003 }
      ];

      SorobanEvent.findAll.mockResolvedValue(mockEvents);

      const networkState = {};
      const issues = await detector.detectSequenceInconsistencies(networkState, 900);

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('OUT_OF_ORDER_SEQUENCE');
      expect(issues[0].data.sequence).toBe(1001);
      expect(issues[0].data.lastSequence).toBe(1002);
    });
  });

  describe('detectOrphanedEvents', () => {
    it('should detect orphaned events', async () => {
      const mockOrphanedEvents = [
        { id: 'event1', ledger_sequence: 1100, event_type: 'VestingScheduleCreated' },
        { id: 'event2', ledger_sequence: 1101, event_type: 'TokensClaimed' }
      ];

      SorobanEvent.findAll.mockResolvedValue(mockOrphanedEvents);

      const networkState = { latestSequence: 1050 };
      const issues = await detector.detectOrphanedEvents(networkState);

      expect(issues).toHaveLength(1);
      expect(issues[0].type).toBe('ORPHANED_EVENTS');
      expect(issues[0].severity).toBe('HIGH');
      expect(issues[0].data.count).toBe(2);
    });

    it('should not detect issues when no orphaned events', async () => {
      SorobanEvent.findAll.mockResolvedValue([]);

      const networkState = { latestSequence: 1050 };
      const issues = await detector.detectOrphanedEvents(networkState);

      expect(issues).toHaveLength(0);
    });
  });

  describe('handleRollback', () => {
    it('should handle rollback successfully', async () => {
      const issue = {
        type: 'ROLLBACK_DETECTED',
        data: {
          expectedSequence: 1000,
          actualSequence: 950,
          gap: 50
        }
      };

      const mockRollbackResult = {
        success: true,
        deletedClaims: 5,
        deletedSchedules: 2,
        newHead: 950
      };

      // Mock stellarIngestionService
      const mockStellarIngestionService = {
        rollbackToLedger: jest.fn().mockResolvedValue(mockRollbackResult)
      };

      jest.doMock('./stellarIngestionService', () => mockStellarIngestionService);

      // Mock SorobanEvent.destroy
      SorobanEvent.destroy.mockResolvedValue(10);

      const result = await detector.handleRollback(issue, 'test_check_id');

      expect(mockStellarIngestionService.rollbackToLedger).toHaveBeenCalledWith(950);
      expect(SorobanEvent.destroy).toHaveBeenCalledWith({
        where: {
          ledger_sequence: {
            [mockSequelize.Sequelize.Op.gt]: 950
          }
        }
      });
    });
  });

  describe('handleFork', () => {
    it('should handle fork successfully', async () => {
      const issue = {
        type: 'FORK_DETECTED',
        data: {
          sequence: 1000,
          cachedHash: 'cached-hash',
          networkHash: 'network-hash'
        }
      };

      const mockRollbackResult = {
        success: true,
        deletedClaims: 3,
        deletedSchedules: 1,
        newHead: 990
      };

      const mockStellarIngestionService = {
        rollbackToLedger: jest.fn().mockResolvedValue(mockRollbackResult)
      };

      jest.doMock('./stellarIngestionService', () => mockStellarIngestionService);

      SorobanEvent.destroy.mockResolvedValue(5);

      const result = await detector.handleFork(issue, 'test_check_id');

      expect(mockStellarIngestionService.rollbackToLedger).toHaveBeenCalledWith(990);
      expect(SorobanEvent.destroy).toHaveBeenCalledWith({
        where: {
          ledger_sequence: {
            [mockSequelize.Sequelize.Op.gt]: 990
          }
        }
      });
    });
  });

  describe('updateLedgerHashCache', () => {
    it('should update ledger hash cache correctly', async () => {
      const networkState = {
        latestSequence: 1000,
        ledgerHashes: new Map([
          [950, 'hash-950'],
          [951, 'hash-951'],
          [1000, 'hash-1000']
        ])
      };

      detector.updateLedgerHashCache(networkState);

      expect(detector.ledgerHashes.size).toBe(3);
      expect(detector.ledgerHashes.get(950)).toBe('hash-950');
      expect(detector.ledgerHashes.get(1000)).toBe('hash-1000');
    });

    it('should remove old hashes beyond cache size', async () => {
      // Set maxReorgDepth to 50
      detector.maxReorgDepth = 50;

      // Add some old hashes
      detector.ledgerHashes.set(900, 'old-hash-900');
      detector.ledgerHashes.set(910, 'old-hash-910');

      const networkState = {
        latestSequence: 1000,
        ledgerHashes: new Map([[1000, 'hash-1000']])
      };

      detector.updateLedgerHashCache(networkState);

      // Old hashes should be removed (below 1000 - 50 = 950)
      expect(detector.ledgerHashes.has(900)).toBe(false);
      expect(detector.ledgerHashes.has(910)).toBe(false);
      expect(detector.ledgerHashes.has(1000)).toBe(true);
    });
  });

  describe('clearLedgerHashCache', () => {
    it('should clear ledger hash cache beyond sequence', () => {
      detector.ledgerHashes.set(950, 'hash-950');
      detector.ledgerHashes.set(960, 'hash-960');
      detector.ledgerHashes.set(970, 'hash-970');

      detector.clearLedgerHashCache(960);

      expect(detector.ledgerHashes.has(950)).toBe(true);
      expect(detector.ledgerHashes.has(960)).toBe(true);
      expect(detector.ledgerHashes.has(970)).toBe(false);
    });
  });

  describe('getLastProcessedLedger', () => {
    it('should return 0 when no state exists', async () => {
      IndexerState.findByPk.mockResolvedValue(null);

      const result = await detector.getLastProcessedLedger();

      expect(result).toBe(0);
      expect(IndexerState.findByPk).toHaveBeenCalledWith(detector.serviceName);
    });

    it('should return last processed ledger when state exists', async () => {
      const mockState = { last_ingested_ledger: 500 };
      IndexerState.findByPk.mockResolvedValue(mockState);

      const result = await detector.getLastProcessedLedger();

      expect(result).toBe(500);
    });
  });

  describe('getStatus', () => {
    it('should return correct status', () => {
      detector.isRunning = true;
      detector.startTime = Date.now() - 60000;
      detector.lastCheckTime = Date.now() - 30000;
      detector.consecutiveGaps = 2;
      detector.ledgerHashes.set(1000, 'hash-1000');

      const status = detector.getStatus();

      expect(status).toEqual({
        isRunning: true,
        checkInterval: 5000,
        maxReorgDepth: 50,
        finalityThreshold: 10,
        consecutiveGaps: 2,
        ledgerHashesCacheSize: 1,
        lastCheckTime: detector.lastCheckTime,
        uptime: expect.any(Number)
      });
    });
  });

  describe('triggerCheck', () => {
    it('should trigger reorg check manually', async () => {
      mockRpcClient.getLatestLedger.mockResolvedValue({
        sequence: 1000,
        hash: 'test-hash'
      });

      IndexerState.findByPk.mockResolvedValue(null);

      const result = await detector.triggerCheck();

      expect(result).toHaveProperty('checkId');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('duration');
    });
  });
});
