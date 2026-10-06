// Mock sequelize connection first
jest.mock('../database/connection', () => {
  return {
    sequelize: {
      transaction: jest.fn(() => ({
        commit: jest.fn(),
        rollback: jest.fn()
      }))
    }
  };
});

// Mock models
jest.mock('../models', () => {
  const SequelizeMock = require('sequelize-mock');
  const dbMock = new SequelizeMock();
  
  const IndexerStateMock = dbMock.define('IndexerState', {
    service_name: 'stellar-indexer',
    last_ingested_ledger: 100
  });

  const ClaimsHistoryMock = dbMock.define('ClaimsHistory', {
    id: 1,
    block_number: 105
  });

  const SubScheduleMock = dbMock.define('SubSchedule', {
    id: 1,
    block_number: 105
  });
  
  // Need to require connection mock inside factory to avoid hoisting issues
  const { sequelize } = require('../database/connection');

  return {
    IndexerState: IndexerStateMock,
    ClaimsHistory: ClaimsHistoryMock,
    SubSchedule: SubScheduleMock,
    sequelize: sequelize
  };
});

// Mock Sequelize Op
jest.mock('sequelize', () => {
  return {
    Op: {
      gt: Symbol('gt')
    }
  };
});

// Import service after mocks are set up
const stellarIngestionService = require('./stellarIngestionService');
const { IndexerState, ClaimsHistory, SubSchedule, sequelize } = require('../models');

describe('StellarIngestionService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getLastIngestedLedger', () => {
    it('should return the stored ledger sequence', async () => {
      IndexerState.findByPk = jest.fn().mockResolvedValue({ last_ingested_ledger: 12345 });
      
      const ledger = await stellarIngestionService.getLastIngestedLedger();
      expect(ledger).toBe(12345);
    });

    it('should return 0 if no state exists', async () => {
      IndexerState.findByPk = jest.fn().mockResolvedValue(null);
      
      const ledger = await stellarIngestionService.getLastIngestedLedger();
      expect(ledger).toBe(0);
    });
  });

  describe('rollbackToLedger', () => {
    it('should delete records greater than target sequence and update state', async () => {
      const targetSequence = 100;
      
      // Setup transaction mock return value
      const mockTransaction = {
        commit: jest.fn(),
        rollback: jest.fn()
      };
      sequelize.transaction.mockResolvedValue(mockTransaction);
      
      ClaimsHistory.destroy = jest.fn().mockResolvedValue(5);
      SubSchedule.destroy = jest.fn().mockResolvedValue(2);
      IndexerState.findOrCreate = jest.fn().mockResolvedValue([
        { 
          last_ingested_ledger: 110,
          save: jest.fn()
        }, 
        false
      ]);

      const result = await stellarIngestionService.rollbackToLedger(targetSequence);

      expect(ClaimsHistory.destroy).toHaveBeenCalled();
      expect(SubSchedule.destroy).toHaveBeenCalled();
      expect(sequelize.transaction).toHaveBeenCalled();
      
      expect(result.success).toBe(true);
      expect(result.deletedClaims).toBe(5);
      expect(result.deletedSchedules).toBe(2);
      expect(result.newHead).toBe(targetSequence);
    });

    it('should rollback transaction on error', async () => {
      const mockTransaction = {
        commit: jest.fn(),
        rollback: jest.fn()
      };
      
      // Setup the transaction mock correctly before the test execution
      sequelize.transaction.mockResolvedValue(mockTransaction);
      
      ClaimsHistory.destroy = jest.fn().mockRejectedValue(new Error('Database error'));

      await expect(stellarIngestionService.rollbackToLedger(100))
        .rejects.toThrow('Database error');

      expect(mockTransaction.rollback).toHaveBeenCalled();
      expect(mockTransaction.commit).not.toHaveBeenCalled();
    });
  });
});
