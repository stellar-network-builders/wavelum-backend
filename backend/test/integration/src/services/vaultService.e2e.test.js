/**
 * VaultService End-to-End Tests
 * 
 * End-to-end tests to verify distribution ratio calculation
 * works correctly with realistic scenarios.
 */

const VaultService = require('./vaultService');
const { Vault, SubSchedule, Beneficiary } = require('../models');
const BalanceTracker = require('./balanceTracker');
const ClaimCalculator = require('./claimCalculator');

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

describe('VaultService E2E - Distribution Ratios', () => {
  let vaultService;

  beforeEach(() => {
    jest.clearAllMocks();
    vaultService = new VaultService();
  });

  it('should calculate correct distribution ratios for fee-on-transfer token (1% fee)', async () => {
    // Scenario: 1M tokens deposited, 1% fee = 990K actual balance
    // 3 beneficiaries with different allocations
    const mockVault = {
      id: 'vault-fee-token',
      address: 'GVAULT_FEE',
      token_address: 'GTOKEN_FEE',
      token_type: 'dynamic',
      total_amount: '1000000', // Tracked amount
    };

    const mockSubSchedules = [
      {
        id: 'sub-1',
        top_up_amount: '500000',
        amount_withdrawn: '0',
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 31536000,
        cliff_date: null,
        cliff_duration: 0,
      },
      {
        id: 'sub-2',
        top_up_amount: '300000',
        amount_withdrawn: '0',
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 31536000,
        cliff_date: null,
        cliff_duration: 0,
      },
      {
        id: 'sub-3',
        top_up_amount: '200000',
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
        address: 'GBEN1_FEE',
        email: 'ben1@example.com',
        total_allocated: '500000', // 50%
        total_withdrawn: '0',
      },
      {
        id: 'ben-2',
        address: 'GBEN2_FEE',
        email: 'ben2@example.com',
        total_allocated: '300000', // 30%
        total_withdrawn: '0',
      },
      {
        id: 'ben-3',
        address: 'GBEN3_FEE',
        email: 'ben3@example.com',
        total_allocated: '200000', // 20%
        total_withdrawn: '0',
      },
    ];

    Vault.findByPk.mockResolvedValue(mockVault);
    SubSchedule.findAll.mockResolvedValue(mockSubSchedules);
    Beneficiary.findAll.mockResolvedValue(mockBeneficiaries);
    
    vaultService.balanceTracker.getActualBalance.mockResolvedValue('990000'); // 1% fee
    vaultService.claimCalculator.calculateTotalVested.mockReturnValue(500000); // 50% vested

    const result = await vaultService.queryBalanceInfo('vault-fee-token');

    expect(result.trackedBalance).toBe('1000000');
    expect(result.actualBalance).toBe('990000');
    expect(result.balanceDelta).toBe('-10000'); // Lost 10K to fees
    expect(result.tokenType).toBe('dynamic');
    expect(result.distributionRatios).toHaveLength(3);

    // Verify beneficiary 1 (50% allocation)
    const ben1 = result.distributionRatios[0];
    expect(ben1.beneficiary_address).toBe('GBEN1_FEE');
    expect(ben1.allocated_amount).toBe('500000');
    expect(ben1.ratio).toBe('0.500000');
    expect(parseFloat(ben1.proportional_share)).toBeCloseTo(495000, 0); // 50% of 990K

    // Verify beneficiary 2 (30% allocation)
    const ben2 = result.distributionRatios[1];
    expect(ben2.beneficiary_address).toBe('GBEN2_FEE');
    expect(ben2.allocated_amount).toBe('300000');
    expect(ben2.ratio).toBe('0.300000');
    expect(parseFloat(ben2.proportional_share)).toBeCloseTo(297000, 0); // 30% of 990K

    // Verify beneficiary 3 (20% allocation)
    const ben3 = result.distributionRatios[2];
    expect(ben3.beneficiary_address).toBe('GBEN3_FEE');
    expect(ben3.allocated_amount).toBe('200000');
    expect(ben3.ratio).toBe('0.200000');
    expect(parseFloat(ben3.proportional_share)).toBeCloseTo(198000, 0); // 20% of 990K
  });

  it('should calculate correct distribution ratios after partial withdrawals', async () => {
    // Scenario: Some beneficiaries have already withdrawn tokens
    const mockVault = {
      id: 'vault-partial',
      address: 'GVAULT_PARTIAL',
      token_address: 'GTOKEN_PARTIAL',
      token_type: 'dynamic',
      total_amount: '1000000',
    };

    const mockSubSchedules = [
      {
        id: 'sub-1',
        top_up_amount: '600000',
        amount_withdrawn: '100000', // Already withdrew 100K
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 31536000,
        cliff_date: null,
        cliff_duration: 0,
      },
      {
        id: 'sub-2',
        top_up_amount: '400000',
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
        address: 'GBEN1_PARTIAL',
        email: 'ben1@example.com',
        total_allocated: '600000',
        total_withdrawn: '100000', // Already withdrew
      },
      {
        id: 'ben-2',
        address: 'GBEN2_PARTIAL',
        email: 'ben2@example.com',
        total_allocated: '400000',
        total_withdrawn: '0',
      },
    ];

    Vault.findByPk.mockResolvedValue(mockVault);
    SubSchedule.findAll.mockResolvedValue(mockSubSchedules);
    Beneficiary.findAll.mockResolvedValue(mockBeneficiaries);
    
    vaultService.balanceTracker.getActualBalance.mockResolvedValue('900000'); // 900K remaining
    vaultService.claimCalculator.calculateTotalVested.mockReturnValue(500000);

    const result = await vaultService.queryBalanceInfo('vault-partial');

    expect(result.distributionRatios).toHaveLength(2);

    // Beneficiary 1: 60% allocation, already withdrew 100K
    const ben1 = result.distributionRatios[0];
    expect(ben1.withdrawn_amount).toBe('100000');
    expect(parseFloat(ben1.proportional_share)).toBeCloseTo(540000, 0); // 60% of 900K
    expect(parseFloat(ben1.claimable_amount)).toBeCloseTo(440000, 0); // 540K - 100K withdrawn

    // Beneficiary 2: 40% allocation, no withdrawals
    const ben2 = result.distributionRatios[1];
    expect(ben2.withdrawn_amount).toBe('0');
    expect(parseFloat(ben2.proportional_share)).toBeCloseTo(360000, 0); // 40% of 900K
    expect(parseFloat(ben2.claimable_amount)).toBeCloseTo(360000, 0); // No withdrawals yet
  });

  it('should handle rebase token with increased balance', async () => {
    // Scenario: Positive rebase increased balance from 1M to 1.1M
    const mockVault = {
      id: 'vault-rebase-positive',
      address: 'GVAULT_REBASE_POS',
      token_address: 'GTOKEN_REBASE_POS',
      token_type: 'dynamic',
      total_amount: '1000000', // Original tracked amount
    };

    const mockSubSchedules = [
      {
        id: 'sub-1',
        top_up_amount: '1000000',
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
        address: 'GBEN1_REBASE',
        email: 'ben1@example.com',
        total_allocated: '1000000',
        total_withdrawn: '0',
      },
    ];

    Vault.findByPk.mockResolvedValue(mockVault);
    SubSchedule.findAll.mockResolvedValue(mockSubSchedules);
    Beneficiary.findAll.mockResolvedValue(mockBeneficiaries);
    
    vaultService.balanceTracker.getActualBalance.mockResolvedValue('1100000'); // 10% rebase gain
    vaultService.claimCalculator.calculateTotalVested.mockReturnValue(500000);

    const result = await vaultService.queryBalanceInfo('vault-rebase-positive');

    expect(result.trackedBalance).toBe('1000000');
    expect(result.actualBalance).toBe('1100000');
    expect(result.balanceDelta).toBe('100000'); // Gained 100K from rebase
    
    const ben1 = result.distributionRatios[0];
    expect(parseFloat(ben1.proportional_share)).toBeCloseTo(1100000, 0); // Gets full 1.1M
    expect(parseFloat(ben1.claimable_amount)).toBeCloseTo(1100000, 0);
  });

  it('should handle rebase token with decreased balance', async () => {
    // Scenario: Negative rebase decreased balance from 1M to 900K
    const mockVault = {
      id: 'vault-rebase-negative',
      address: 'GVAULT_REBASE_NEG',
      token_address: 'GTOKEN_REBASE_NEG',
      token_type: 'dynamic',
      total_amount: '1000000', // Original tracked amount
    };

    const mockSubSchedules = [
      {
        id: 'sub-1',
        top_up_amount: '1000000',
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
        address: 'GBEN1_REBASE_NEG',
        email: 'ben1@example.com',
        total_allocated: '1000000',
        total_withdrawn: '0',
      },
    ];

    Vault.findByPk.mockResolvedValue(mockVault);
    SubSchedule.findAll.mockResolvedValue(mockSubSchedules);
    Beneficiary.findAll.mockResolvedValue(mockBeneficiaries);
    
    vaultService.balanceTracker.getActualBalance.mockResolvedValue('900000'); // 10% rebase loss
    vaultService.claimCalculator.calculateTotalVested.mockReturnValue(500000);

    const result = await vaultService.queryBalanceInfo('vault-rebase-negative');

    expect(result.trackedBalance).toBe('1000000');
    expect(result.actualBalance).toBe('900000');
    expect(result.balanceDelta).toBe('-100000'); // Lost 100K from rebase
    
    const ben1 = result.distributionRatios[0];
    expect(parseFloat(ben1.proportional_share)).toBeCloseTo(900000, 0); // Gets reduced 900K
    expect(parseFloat(ben1.claimable_amount)).toBeCloseTo(900000, 0);
  });
});
