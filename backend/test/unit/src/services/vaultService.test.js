/**
 * VaultService Tests
 * 
 * Tests for vault service operations including balance queries
 * and distribution ratio calculations for dynamic tokens.
 */

const VaultService = require('./vaultService');
const { Vault, SubSchedule, Beneficiary } = require('../models');
const BalanceTracker = require('./balanceTracker');
const ClaimCalculator = require('./claimCalculator');

// Mock the models
jest.mock('../models', () => ({
  Vault: {
    findByPk: jest.fn(),
  },
  SubSchedule: {
    findAll: jest.fn(),
  },
  Beneficiary: {
    findAll: jest.fn(),
  },
}));

jest.mock('./balanceTracker');
jest.mock('./claimCalculator');

describe('VaultService', () => {
  let vaultService;
  let mockBalanceTracker;
  let mockClaimCalculator;

  beforeEach(() => {
    jest.clearAllMocks();
    
    vaultService = new VaultService();
    mockBalanceTracker = vaultService.balanceTracker;
    mockClaimCalculator = vaultService.claimCalculator;
  });

  describe('queryBalanceInfo', () => {
    it('should return balance info for static vault without distribution ratios', async () => {
      const mockVault = {
        id: 'vault-123',
        address: 'GVAULT123',
        token_address: 'GTOKEN123',
        token_type: 'static',
        total_amount: '1000000',
      };

      Vault.findByPk.mockResolvedValue(mockVault);

      const result = await vaultService.queryBalanceInfo('vault-123');

      expect(result).toBeDefined();
      expect(result.trackedBalance).toBe('1000000');
      expect(result.actualBalance).toBe('1000000');
      expect(result.tokenType).toBe('static');
      expect(result.distributionRatios).toBeUndefined();
    });

    it('should return balance info with distribution ratios for dynamic vault', async () => {
      const mockVault = {
        id: 'vault-456',
        address: 'GVAULT456',
        token_address: 'GTOKEN456',
        token_type: 'dynamic',
        total_amount: '1000000',
      };

      const mockSubSchedules = [
        {
          id: 'sub-1',
          top_up_amount: '500000',
          amount_withdrawn: '0',
          vesting_start_date: new Date('2024-01-01'),
          vesting_duration: 31536000, // 1 year in seconds
          cliff_date: null,
          cliff_duration: 0,
        },
        {
          id: 'sub-2',
          top_up_amount: '500000',
          amount_withdrawn: '0',
          vesting_start_date: new Date('2024-01-01'),
          vesting_duration: 31536000,
          cliff_date: null,
          cliff_duration: 0,
        },
      ];

      const mockBeneficiaries = [
        {
          id: 'ben-1',
          address: 'GBEN1',
          email: 'ben1@example.com',
          total_allocated: '600000',
          total_withdrawn: '0',
        },
        {
          id: 'ben-2',
          address: 'GBEN2',
          email: 'ben2@example.com',
          total_allocated: '400000',
          total_withdrawn: '0',
        },
      ];

      Vault.findByPk.mockResolvedValue(mockVault);
      SubSchedule.findAll.mockResolvedValue(mockSubSchedules);
      Beneficiary.findAll.mockResolvedValue(mockBeneficiaries);
      
      mockBalanceTracker.getActualBalance.mockResolvedValue('990000'); // 1% fee
      mockClaimCalculator.calculateTotalVested.mockReturnValue(500000); // 50% vested

      const result = await vaultService.queryBalanceInfo('vault-456');

      expect(result).toBeDefined();
      expect(result.trackedBalance).toBe('1000000');
      expect(result.actualBalance).toBe('990000');
      expect(result.tokenType).toBe('dynamic');
      expect(result.distributionRatios).toBeDefined();
      expect(result.distributionRatios).toHaveLength(2);
      
      // Verify first beneficiary (60% allocation)
      expect(result.distributionRatios[0].beneficiary_id).toBe('ben-1');
      expect(result.distributionRatios[0].beneficiary_address).toBe('GBEN1');
      expect(result.distributionRatios[0].allocated_amount).toBe('600000');
      expect(result.distributionRatios[0].ratio).toBe('0.600000');
      
      // Verify second beneficiary (40% allocation)
      expect(result.distributionRatios[1].beneficiary_id).toBe('ben-2');
      expect(result.distributionRatios[1].beneficiary_address).toBe('GBEN2');
      expect(result.distributionRatios[1].allocated_amount).toBe('400000');
      expect(result.distributionRatios[1].ratio).toBe('0.400000');
    });

    it('should throw error if vault not found', async () => {
      Vault.findByPk.mockResolvedValue(null);

      await expect(vaultService.queryBalanceInfo('nonexistent'))
        .rejects.toThrow('Vault not found: nonexistent');
    });
  });
});
