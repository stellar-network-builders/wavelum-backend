/**
 * VaultService Integration Tests
 * 
 * Integration tests to verify distribution ratio calculation
 * and BalanceInfo JSON serialization.
 */

const VaultService = require('./vaultService');
const BalanceInfo = require('../models/BalanceInfo');

describe('VaultService - Distribution Ratios Integration', () => {
  it('should correctly format distribution ratios in BalanceInfo JSON output', () => {
    const distributionRatios = [
      {
        beneficiary_id: 'ben-1',
        beneficiary_address: 'GBEN1',
        beneficiary_email: 'ben1@example.com',
        allocated_amount: '600000',
        withdrawn_amount: '100000',
        ratio: '0.600000',
        proportional_share: '594000.000000000000000000',
        claimable_amount: '494000.000000000000000000'
      },
      {
        beneficiary_id: 'ben-2',
        beneficiary_address: 'GBEN2',
        beneficiary_email: 'ben2@example.com',
        allocated_amount: '400000',
        withdrawn_amount: '50000',
        ratio: '0.400000',
        proportional_share: '396000.000000000000000000',
        claimable_amount: '346000.000000000000000000'
      }
    ];

    const balanceInfo = new BalanceInfo(
      '1000000',
      '990000',
      'dynamic',
      distributionRatios
    );

    const json = balanceInfo.toJSON();

    expect(json.tracked_balance).toBe('1000000');
    expect(json.actual_balance).toBe('990000');
    expect(json.balance_delta).toBe('-10000');
    expect(json.token_type).toBe('dynamic');
    expect(json.distribution_ratios).toBeDefined();
    expect(json.distribution_ratios).toHaveLength(2);
    
    // Verify first beneficiary
    expect(json.distribution_ratios[0].beneficiary_id).toBe('ben-1');
    expect(json.distribution_ratios[0].ratio).toBe('0.600000');
    expect(json.distribution_ratios[0].claimable_amount).toBe('494000.000000000000000000');
    
    // Verify second beneficiary
    expect(json.distribution_ratios[1].beneficiary_id).toBe('ben-2');
    expect(json.distribution_ratios[1].ratio).toBe('0.400000');
    expect(json.distribution_ratios[1].claimable_amount).toBe('346000.000000000000000000');
  });

  it('should not include distribution_ratios for static tokens', () => {
    const balanceInfo = new BalanceInfo(
      '1000000',
      '1000000',
      'static',
      null
    );

    const json = balanceInfo.toJSON();

    expect(json.tracked_balance).toBe('1000000');
    expect(json.actual_balance).toBe('1000000');
    expect(json.balance_delta).toBe('0');
    expect(json.token_type).toBe('static');
    expect(json.distribution_ratios).toBeUndefined();
  });

  it('should handle empty distribution ratios array for dynamic tokens', () => {
    const balanceInfo = new BalanceInfo(
      '1000000',
      '990000',
      'dynamic',
      []
    );

    const json = balanceInfo.toJSON();

    expect(json.token_type).toBe('dynamic');
    expect(json.distribution_ratios).toBeDefined();
    expect(json.distribution_ratios).toHaveLength(0);
  });
});
