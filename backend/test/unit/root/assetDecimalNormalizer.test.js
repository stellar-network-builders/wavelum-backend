const { AssetDecimalNormalizer } = require('./src/services/assetDecimalNormalizer');

describe('AssetDecimalNormalizer', () => {
  let normalizer;

  beforeEach(() => {
    normalizer = new AssetDecimalNormalizer();
  });

  describe('Basic functionality', () => {
    test('should initialize with default asset decimals', () => {
      expect(normalizer.getAssetDecimals('XLM')).toBe(7);
      expect(normalizer.getAssetDecimals('USDC')).toBe(6);
      expect(normalizer.getAssetDecimals('EURC')).toBe(6);
      expect(normalizer.getAssetDecimals('BTC')).toBe(8);
      expect(normalizer.getAssetDecimals('ETH')).toBe(18);
    });

    test('should return default decimals for unknown assets', () => {
      expect(normalizer.getAssetDecimals('UNKNOWN')).toBe(7);
    });

    test('should handle case insensitive asset codes', () => {
      expect(normalizer.getAssetDecimals('xlm')).toBe(7);
      expect(normalizer.getAssetDecimals('usdc')).toBe(6);
      expect(normalizer.getAssetDecimals('USDC')).toBe(6);
    });
  });

  describe('Asset decimal management', () => {
    test('should set custom asset decimals', () => {
      normalizer.setAssetDecimals('CUSTOM', 12);
      expect(normalizer.getAssetDecimals('CUSTOM')).toBe(12);
    });

    test('should throw error for invalid decimal places', () => {
      expect(() => normalizer.setAssetDecimals('INVALID', -1)).toThrow();
      expect(() => normalizer.setAssetDecimals('INVALID', 19)).toThrow();
      expect(() => normalizer.setAssetDecimals('INVALID', 'invalid')).toThrow();
    });

    test('should get supported assets', () => {
      const assets = normalizer.getSupportedAssets();
      expect(assets).toHaveProperty('XLM', 7);
      expect(assets).toHaveProperty('USDC', 6);
      expect(assets).toHaveProperty('BTC', 8);
    });
  });

  describe('Amount normalization', () => {
    test('should normalize amounts between different decimal places', () => {
      // Convert 1.5 USDC (6 decimals) to XLM (7 decimals)
      const normalized = normalizer.normalizeAmount('1.5', 6, 7);
      expect(normalized.toString()).toBe('15');
    });

    test('should handle same decimal places', () => {
      const normalized = normalizer.normalizeAmount('100.5', 6, 6);
      expect(normalized.toString()).toBe('100.5');
    });

    test('should convert to base precision', () => {
      const base = normalizer.toBasePrecision('1000000', 'USDC');
      expect(base.toString()).toBe('1000000000000000000000000');
    });

    test('should convert from base precision', () => {
      const amount = normalizer.fromBasePrecision('1000000000000000000000000', 'USDC');
      expect(amount).toBe('1000000');
    });

    test('should handle zero amounts', () => {
      const base = normalizer.toBasePrecision('0', 'XLM');
      expect(base.toString()).toBe('0');
      
      const amount = normalizer.fromBasePrecision('0', 'XLM');
      expect(amount).toBe('0');
    });
  });

  describe('Cross-asset operations', () => {
    test('should add amounts from different assets', () => {
      // Add 1 XLM (7 decimals) + 1 USDC (6 decimals) = result in XLM
      const sum = normalizer.addAmounts('10000000', 'XLM', '1000000', 'USDC', 'XLM');
      expect(sum).toBe('11000000');
    });

    test('should add amounts with different result asset', () => {
      // Add 1 XLM (7 decimals) + 1 USDC (6 decimals) = result in USDC
      const sum = normalizer.addAmounts('10000000', 'XLM', '1000000', 'USDC', 'USDC');
      expect(sum).toBe('1100000');
    });

    test('should calculate weighted average for vesting schedules', () => {
      const schedules = [
        {
          assetCode: 'XLM',
          unvestedBalance: '10000000', // 1 XLM
          cliff: '2024-01-01T00:00:00Z'
        },
        {
          assetCode: 'USDC',
          unvestedBalance: '2000000', // 2 USDC
          cliff: '2024-02-01T00:00:00Z'
        }
      ];

      const average = normalizer.calculateWeightedAverage(schedules, 'unvestedBalance', 'XLM');
      expect(average).toBeDefined();
      expect(typeof average).toBe('string');
    });

    test('should sum unvested balances across different assets', () => {
      const schedules = [
        {
          assetCode: 'XLM',
          unvestedBalance: '10000000' // 1 XLM
        },
        {
          assetCode: 'USDC',
          unvestedBalance: '2000000' // 2 USDC
        }
      ];

      const total = normalizer.sumUnvestedBalances(schedules, 'XLM');
      expect(total).toBeDefined();
      expect(typeof total).toBe('string');
    });

    test('should handle empty schedules array', () => {
      const total = normalizer.sumUnvestedBalances([], 'XLM');
      expect(total).toBe('0');
    });
  });

  describe('Schedule normalization', () => {
    test('should normalize vesting schedule to target asset', () => {
      const schedule = {
        id: 'test-schedule',
        beneficiary: 'test-address',
        assetCode: 'USDC',
        unvestedBalance: '1000000',
        totalAmount: '5000000',
        vestedAmount: '2000000'
      };

      const normalized = normalizer.normalizeSchedule(schedule, 'XLM');
      expect(normalized.assetCode).toBe('XLM');
      expect(normalized.unvestedBalance).toBeDefined();
      expect(normalized.totalAmount).toBeDefined();
      expect(normalized.vestedAmount).toBeDefined();
    });

    test('should preserve schedule structure during normalization', () => {
      const schedule = {
        id: 'test-schedule',
        beneficiary: 'test-address',
        assetCode: 'USDC',
        unvestedBalance: '1000000',
        startDate: '2024-01-01T00:00:00Z',
        endDate: '2025-01-01T00:00:00Z'
      };

      const normalized = normalizer.normalizeSchedule(schedule, 'XLM');
      expect(normalized.id).toBe(schedule.id);
      expect(normalized.beneficiary).toBe(schedule.beneficiary);
      expect(normalized.startDate).toBe(schedule.startDate);
      expect(normalized.endDate).toBe(schedule.endDate);
    });
  });

  describe('Precision validation', () => {
    test('should validate amount precision for assets', () => {
      expect(normalizer.validateAmountPrecision('100.1234567', 'USDC')).toBe(false); // Too many decimals
      expect(normalizer.validateAmountPrecision('100.123456', 'USDC')).toBe(true);  // Correct decimals
      expect(normalizer.validateAmountPrecision('100', 'XLM')).toBe(true);          // No decimals is fine
    });

    test('should handle string amounts in validation', () => {
      expect(normalizer.validateAmountPrecision('100.5', 'USDC')).toBe(true);
      expect(normalizer.validateAmountPrecision('100.1234567', 'USDC')).toBe(false);
    });
  });

  describe('Amount formatting', () => {
    test('should format amounts with correct decimal places', () => {
      const formatted = normalizer.formatAmount('100.123456789', 'USDC');
      expect(formatted).toBe('100.123456');
    });

    test('should handle integer amounts', () => {
      const formatted = normalizer.formatAmount('100', 'XLM');
      expect(formatted).toBe('100');
    });

    test('should pad with zeros if needed', () => {
      const formatted = normalizer.formatAmount('100.1', 'USDC');
      expect(formatted).toBe('100.100000');
    });
  });

  describe('Edge cases and error handling', () => {
    test('should handle very large numbers', () => {
      const largeAmount = '999999999999999999999999999999';
      const base = normalizer.toBasePrecision(largeAmount, 'XLM');
      expect(base.toString()).toBeDefined();
    });

    test('should handle very small numbers', () => {
      const smallAmount = '0.0000001';
      const base = normalizer.toBasePrecision(smallAmount, 'XLM');
      expect(base.toString()).toBeDefined();
    });

    test('should handle negative amounts', () => {
      const negativeAmount = '-1000000';
      const base = normalizer.toBasePrecision(negativeAmount, 'USDC');
      expect(base.isNegative()).toBe(true);
    });

    test('should handle undefined/null amounts gracefully', () => {
      expect(() => normalizer.toBasePrecision(undefined, 'XLM')).not.toThrow();
      expect(() => normalizer.toBasePrecision(null, 'XLM')).not.toThrow();
    });
  });

  describe('Real-world scenarios', () => {
    test('should handle XLM to USDC conversion', () => {
      // 1.5 XLM (7 decimals) to USDC (6 decimals)
      const xlmAmount = '15000000'; // 1.5 XLM in smallest units
      const usdcAmount = normalizer.addAmounts(xlmAmount, 'XLM', 0, 'USDC', 'USDC');
      
      // Should be approximately 1.5 USDC (accounting for decimal conversion)
      expect(parseFloat(usdcAmount)).toBeCloseTo(1500000, 0);
    });

    test('should handle multi-asset vesting consolidation', () => {
      const schedules = [
        {
          assetCode: 'XLM',
          unvestedBalance: '50000000', // 5 XLM
          totalAmount: '100000000',    // 10 XLM total
          vestedAmount: '50000000'     // 5 XLM vested
        },
        {
          assetCode: 'USDC',
          unvestedBalance: '3000000',  // 3 USDC
          totalAmount: '10000000',     // 10 USDC total
          vestedAmount: '7000000'      // 7 USDC vested
        }
      ];

      // Consolidate to XLM
      const totalUnvested = normalizer.sumUnvestedBalances(schedules, 'XLM');
      expect(totalUnvested).toBeDefined();
      expect(parseFloat(totalUnvested)).toBeGreaterThan(0);

      // Normalize each schedule to XLM
      const normalizedSchedules = schedules.map(schedule => 
        normalizer.normalizeSchedule(schedule, 'XLM')
      );

      expect(normalizedSchedules).toHaveLength(2);
      expect(normalizedSchedules[0].assetCode).toBe('XLM');
      expect(normalizedSchedules[1].assetCode).toBe('XLM');
    });
  });
});
