/**
 * Tests for IndexingService deposit handling logic
 */

// Mock all dependencies before imports
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}), { virtual: true });

jest.mock('./priceService', () => ({
  getTokenPrice: jest.fn(),
}));

jest.mock('./slackWebhookService', () => ({
  processClaimAlert: jest.fn(),
}));

jest.mock('./tvlService', () => ({
  handleClaim: jest.fn(),
}));

jest.mock('./cacheService', () => ({
  invalidateUserPortfolio: jest.fn(),
}));

jest.mock('./balanceTracker');
jest.mock('./claimCalculator');

jest.mock('../models', () => {
  const mockVault = {
    findOne: jest.fn(),
  };
  const mockSubSchedule = {
    create: jest.fn(),
  };
  return {
    Vault: mockVault,
    SubSchedule: mockSubSchedule,
    ClaimsHistory: {
      create: jest.fn(),
      findAll: jest.fn(),
    },
  };
});

const { IndexingService } = require('./indexingService');
const { Vault, SubSchedule } = require('../models');
const BalanceTracker = require('./balanceTracker');
const ClaimCalculator = require('./claimCalculator');

describe('IndexingService - Deposit Handling', () => {
  let indexingService;
  let mockBalanceTracker;

  beforeEach(() => {
    jest.clearAllMocks();
    indexingService = new IndexingService();
    
    // Setup BalanceTracker mock
    mockBalanceTracker = {
      getActualBalance: jest.fn(),
      verifyDeposit: jest.fn(),
    };
    BalanceTracker.mockImplementation(() => mockBalanceTracker);

    // Suppress console output for cleaner test runs
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('processTopUpEvent - Static Token', () => {
    it('should use transfer amount for static tokens', async () => {
      const mockVault = {
        id: 'vault-123',
        vault_address: 'GVAULT123',
        token_address: 'CTOKEN123',
        token_type: 'static',
        total_amount: '1000000',
        update: jest.fn().mockResolvedValue(true),
      };

      const mockSubSchedule = {
        id: 'sub-123',
        vault_id: 'vault-123',
        top_up_amount: '100000',
      };

      Vault.findOne.mockResolvedValue(mockVault);
      SubSchedule.create.mockResolvedValue(mockSubSchedule);

      const topUpData = {
        vault_address: 'GVAULT123',
        top_up_amount: '100000',
        transaction_hash: 'tx123',
        block_number: 12345,
        timestamp: new Date().toISOString(),
        vesting_duration: 31536000, // 1 year in seconds
      };

      const result = await indexingService.processTopUpEvent(topUpData);

      // Verify SubSchedule was created with the original amount
      expect(SubSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          top_up_amount: '100000',
        })
      );

      // Verify vault total_amount was updated with the original amount
      expect(mockVault.update).toHaveBeenCalledWith({
        total_amount: 1100000, // 1000000 + 100000
      });

      // Verify BalanceTracker was NOT called for static tokens
      expect(mockBalanceTracker.getActualBalance).not.toHaveBeenCalled();
      expect(mockBalanceTracker.verifyDeposit).not.toHaveBeenCalled();
    });
  });

  describe('processTopUpEvent - Dynamic Token', () => {
    it('should query actual balance and record actual received amount for dynamic tokens', async () => {
      const mockVault = {
        id: 'vault-123',
        vault_address: 'GVAULT123',
        token_address: 'CTOKEN123',
        token_type: 'dynamic',
        total_amount: '1000000',
        update: jest.fn().mockResolvedValue(true),
      };

      const mockSubSchedule = {
        id: 'sub-123',
        vault_id: 'vault-123',
        top_up_amount: '99000', // Actual received after 1% fee
      };

      Vault.findOne.mockResolvedValue(mockVault);
      SubSchedule.create.mockResolvedValue(mockSubSchedule);

      // Mock balance tracker to simulate 1% fee
      mockBalanceTracker.getActualBalance.mockResolvedValue('1000000');
      mockBalanceTracker.verifyDeposit.mockResolvedValue('99000'); // 1% fee deducted

      const topUpData = {
        vault_address: 'GVAULT123',
        top_up_amount: '100000',
        transaction_hash: 'tx123',
        block_number: 12345,
        timestamp: new Date().toISOString(),
        vesting_duration: 31536000,
      };

      const result = await indexingService.processTopUpEvent(topUpData);

      // Verify BalanceTracker was called
      expect(mockBalanceTracker.getActualBalance).toHaveBeenCalledWith(
        'CTOKEN123',
        'GVAULT123'
      );
      expect(mockBalanceTracker.verifyDeposit).toHaveBeenCalled();

      // Verify SubSchedule was created with the actual received amount
      expect(SubSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          top_up_amount: '99000', // Actual received, not the transfer amount
        })
      );

      // Verify vault total_amount was updated with actual received amount
      expect(mockVault.update).toHaveBeenCalledWith({
        total_amount: 1099000, // 1000000 + 99000
      });
    });

    it('should handle balance verification failure gracefully', async () => {
      const mockVault = {
        id: 'vault-123',
        vault_address: 'GVAULT123',
        token_address: 'CTOKEN123',
        token_type: 'dynamic',
        total_amount: '1000000',
        update: jest.fn().mockResolvedValue(true),
      };

      const mockSubSchedule = {
        id: 'sub-123',
        vault_id: 'vault-123',
        top_up_amount: '100000',
      };

      Vault.findOne.mockResolvedValue(mockVault);
      SubSchedule.create.mockResolvedValue(mockSubSchedule);

      // Mock balance tracker to throw an error
      mockBalanceTracker.getActualBalance.mockRejectedValue(
        new Error('RPC connection failed')
      );

      const topUpData = {
        vault_address: 'GVAULT123',
        top_up_amount: '100000',
        transaction_hash: 'tx123',
        block_number: 12345,
        timestamp: new Date().toISOString(),
        vesting_duration: 31536000,
      };

      const result = await indexingService.processTopUpEvent(topUpData);

      // Verify it falls back to using the expected amount
      expect(SubSchedule.create).toHaveBeenCalledWith(
        expect.objectContaining({
          top_up_amount: '100000', // Falls back to expected amount
        })
      );

      expect(mockVault.update).toHaveBeenCalledWith({
        total_amount: 1100000, // Uses expected amount as fallback
      });
    });
  });
});

describe('IndexingService - Claim Execution', () => {
  let indexingService;
  let mockBalanceTracker;

  beforeEach(() => {
    jest.clearAllMocks();
    indexingService = new IndexingService();
    
    // Setup BalanceTracker mock
    mockBalanceTracker = {
      getActualBalance: jest.fn(),
      verifyDeposit: jest.fn(),
    };
    BalanceTracker.mockImplementation(() => mockBalanceTracker);

    // Setup ClaimCalculator mock
    ClaimCalculator.mockImplementation(() => ({
      calculateClaimable: jest.fn().mockResolvedValue('50000'),
    }));
  });

  describe('executeClaimForSubSchedule - Static Token', () => {
    it('should execute claim without balance verification for static tokens', async () => {
      const mockVault = {
        id: 'vault-123',
        address: 'GVAULT123',
        token_address: 'CTOKEN123',
        token_type: 'static',
        subSchedules: [],
      };

      const mockSubSchedule = {
        id: 'sub-123',
        vault_id: 'vault-123',
        is_active: true,
        amount_withdrawn: '0',
        top_up_amount: '100000',
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 31536000, // 1 year
        cliff_date: null,
        update: jest.fn().mockResolvedValue(true),
      };

      const { Vault, SubSchedule } = require('../models');
      Vault.findByPk = jest.fn().mockResolvedValue(mockVault);
      SubSchedule.findByPk = jest.fn().mockResolvedValue(mockSubSchedule);

      const result = await indexingService.executeClaimForSubSchedule('vault-123', 'sub-123');

      // Verify subschedule was updated
      expect(mockSubSchedule.update).toHaveBeenCalledWith({
        amount_withdrawn: '50000',
      });

      // Verify BalanceTracker was NOT called for static tokens
      expect(mockBalanceTracker.getActualBalance).not.toHaveBeenCalled();

      // Verify result
      expect(result.amount).toBe(50000);
      expect(result.vault_id).toBe('vault-123');
      expect(result.subschedule_id).toBe('sub-123');
    });
  });

  describe('executeClaimForSubSchedule - Dynamic Token', () => {
    it('should verify balance and execute claim for dynamic tokens', async () => {
      const mockVault = {
        id: 'vault-123',
        address: 'GVAULT123',
        token_address: 'CTOKEN123',
        token_type: 'dynamic',
        subSchedules: [],
      };

      const mockSubSchedule = {
        id: 'sub-123',
        vault_id: 'vault-123',
        is_active: true,
        amount_withdrawn: '0',
        top_up_amount: '100000',
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 31536000,
        cliff_date: null,
        update: jest.fn().mockResolvedValue(true),
      };

      const { Vault, SubSchedule } = require('../models');
      Vault.findByPk = jest.fn().mockResolvedValue(mockVault);
      SubSchedule.findByPk = jest.fn().mockResolvedValue(mockSubSchedule);

      // Mock BalanceTracker to return sufficient balance
      mockBalanceTracker.getActualBalance.mockResolvedValue('100000');

      const result = await indexingService.executeClaimForSubSchedule('vault-123', 'sub-123');

      // Verify BalanceTracker was called
      expect(mockBalanceTracker.getActualBalance).toHaveBeenCalledWith(
        'CTOKEN123',
        'GVAULT123'
      );

      // Verify subschedule was updated
      expect(mockSubSchedule.update).toHaveBeenCalledWith({
        amount_withdrawn: '50000',
      });

      expect(result.amount).toBe(50000);
    });

    it('should throw InsufficientBalanceError when balance is insufficient', async () => {
      const mockVault = {
        id: 'vault-123',
        address: 'GVAULT123',
        token_address: 'CTOKEN123',
        token_type: 'dynamic',
        subSchedules: [],
      };

      const mockSubSchedule = {
        id: 'sub-123',
        vault_id: 'vault-123',
        is_active: true,
        amount_withdrawn: '0',
        top_up_amount: '100000',
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 31536000,
        cliff_date: null,
        update: jest.fn().mockResolvedValue(true),
      };

      const { Vault, SubSchedule } = require('../models');
      Vault.findByPk = jest.fn().mockResolvedValue(mockVault);
      SubSchedule.findByPk = jest.fn().mockResolvedValue(mockSubSchedule);

      // Mock BalanceTracker to return insufficient balance
      mockBalanceTracker.getActualBalance.mockResolvedValue('30000');

      const { InsufficientBalanceError } = require('../errors/VaultErrors');

      await expect(
        indexingService.executeClaimForSubSchedule('vault-123', 'sub-123')
      ).rejects.toThrow(InsufficientBalanceError);

      // Verify subschedule was NOT updated
      expect(mockSubSchedule.update).not.toHaveBeenCalled();
    });

    it('should throw InsufficientBalanceError with descriptive message for zero balance', async () => {
      const mockVault = {
        id: 'vault-123',
        address: 'GVAULT123',
        token_address: 'CTOKEN123',
        token_type: 'dynamic',
        subSchedules: [],
      };

      const mockSubSchedule = {
        id: 'sub-123',
        vault_id: 'vault-123',
        is_active: true,
        amount_withdrawn: '0',
        top_up_amount: '100000',
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 31536000,
        cliff_date: null,
        update: jest.fn().mockResolvedValue(true),
      };

      const { Vault, SubSchedule } = require('../models');
      Vault.findByPk = jest.fn().mockResolvedValue(mockVault);
      SubSchedule.findByPk = jest.fn().mockResolvedValue(mockSubSchedule);

      // Mock BalanceTracker to return zero balance
      mockBalanceTracker.getActualBalance.mockResolvedValue('0');

      const { InsufficientBalanceError } = require('../errors/VaultErrors');

      try {
        await indexingService.executeClaimForSubSchedule('vault-123', 'sub-123');
        fail('Should have thrown InsufficientBalanceError');
      } catch (error) {
        expect(error).toBeInstanceOf(InsufficientBalanceError);
        expect(error.available).toBe(0);
        expect(error.requested).toBe(50000);
      }
    });
  });

  describe('executeSequentialClaims', () => {
    it('should handle sequential claims without panicking when balance depletes', async () => {
      const mockVault = {
        id: 'vault-123',
        address: 'GVAULT123',
        token_address: 'CTOKEN123',
        token_type: 'dynamic',
        subSchedules: [],
      };

      const mockSubSchedule1 = {
        id: 'sub-1',
        vault_id: 'vault-123',
        is_active: true,
        amount_withdrawn: '0',
        top_up_amount: '100000',
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 31536000,
        cliff_date: null,
        update: jest.fn().mockResolvedValue(true),
      };

      const mockSubSchedule2 = {
        id: 'sub-2',
        vault_id: 'vault-123',
        is_active: true,
        amount_withdrawn: '0',
        top_up_amount: '100000',
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 31536000,
        cliff_date: null,
        update: jest.fn().mockResolvedValue(true),
      };

      const { Vault, SubSchedule } = require('../models');
      Vault.findByPk = jest.fn().mockResolvedValue(mockVault);
      SubSchedule.findByPk = jest.fn()
        .mockResolvedValueOnce(mockSubSchedule1)
        .mockResolvedValueOnce(mockSubSchedule2);

      // Mock BalanceTracker - first claim succeeds, second fails due to insufficient balance
      mockBalanceTracker.getActualBalance
        .mockResolvedValueOnce('100000') // First claim: sufficient
        .mockResolvedValueOnce('40000');  // Second claim: insufficient (50000 requested but only 40000 available)

      const claimRequests = [
        { vaultId: 'vault-123', subScheduleId: 'sub-1' },
        { vaultId: 'vault-123', subScheduleId: 'sub-2' },
      ];

      const result = await indexingService.executeSequentialClaims(claimRequests);

      // Verify first claim succeeded
      expect(result.totalProcessed).toBe(1);
      expect(result.successful).toHaveLength(1);
      expect(result.successful[0].subScheduleId).toBe('sub-1');

      // Verify second claim failed gracefully
      expect(result.totalFailed).toBe(1);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].subScheduleId).toBe('sub-2');
      expect(result.failed[0].errorType).toBe('InsufficientBalanceError');
      expect(result.failed[0].requested).toBe(50000);
      expect(result.failed[0].available).toBe(40000);

      // Verify no panics occurred (test completes successfully)
    });

    it('should include error details in failed claims', async () => {
      const { Vault, SubSchedule } = require('../models');
      Vault.findByPk = jest.fn().mockResolvedValue(null); // Vault not found

      const claimRequests = [
        { vaultId: 'vault-404', subScheduleId: 'sub-1' },
      ];

      const result = await indexingService.executeSequentialClaims(claimRequests);

      expect(result.totalFailed).toBe(1);
      expect(result.failed[0].error).toContain('Vault vault-404 not found');
      expect(result.failed[0].errorType).toBe('Error');
    });
  });
});
