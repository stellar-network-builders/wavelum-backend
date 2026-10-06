'use strict';

const { sequelize } = require('../database/connection');
const accountConsolidationService = require('./accountConsolidationService');

describe('AccountConsolidationService', () => {
  beforeAll(async () => {
    // Setup test database
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    // Clean up before each test
    await Promise.all([
      require('../models').Vault.destroy({ where: {}, force: true }),
      require('../models').Beneficiary.destroy({ where: {}, force: true }),
      require('../models').SubSchedule.destroy({ where: {}, force: true }),
    ]);
  });

  describe('getConsolidatedView', () => {
    it('should return empty result for beneficiary with no vaults', async () => {
      // Act
      const result = await accountConsolidationService.getConsolidatedView('UNKNOWN_ADDRESS');

      // Assert
      expect(result.beneficiary_address).toBe('UNKNOWN_ADDRESS');
      expect(result.total_vaults).toBe(0);
      expect(result.total_allocated).toBe('0');
      expect(result.total_withdrawn).toBe('0');
      expect(result.vaults).toHaveLength(0);
    });

    it('should handle beneficiary with vaults correctly', async () => {
      // Arrange - Create test data
      const { Vault, Beneficiary, SubSchedule } = require('../models');
      
      const vault = await Vault.create({
        address: 'TEST_VAULT_ADDRESS',
        owner_address: 'OWNER_ADDRESS',
        token_address: 'TOKEN_ADDRESS',
        total_amount: '1000'
      });

      await Beneficiary.create({
        vault_id: vault.id,
        address: 'TEST_BENEFICIARY',
        total_allocated: '500',
        total_withdrawn: '100'
      });

      await SubSchedule.create({
        vault_id: vault.id,
        top_up_amount: '1000',
        cliff_duration: 86400,
        vesting_start_date: new Date('2023-01-01'),
        vesting_duration: 31536000,
        start_timestamp: new Date('2023-01-01'),
        end_timestamp: new Date('2024-01-01'),
        transaction_hash: 'TEST_TX_HASH'
      });

      // Act
      const result = await accountConsolidationService.getConsolidatedView('TEST_BENEFICIARY');

      // Assert
      expect(result.beneficiary_address).toBe('TEST_BENEFICIARY');
      expect(result.total_vaults).toBe(1);
      expect(result.total_allocated).toBe('500');
      expect(result.total_withdrawn).toBe('100');
      expect(result.vaults).toHaveLength(1);
      expect(result.vaults[0].vault_address).toBe('TEST_VAULT_ADDRESS');
    });
  });

  describe('_calculateVaultWeightedDates', () => {
    it('should calculate weighted average dates correctly', () => {
      // Arrange
      const subSchedules = [
        {
          top_up_amount: '1000',
          cliff_date: new Date('2023-01-01'),
          end_timestamp: new Date('2024-01-01'),
          vesting_duration: 31536000
        },
        {
          top_up_amount: '2000',
          cliff_date: new Date('2023-03-01'),
          end_timestamp: new Date('2024-03-01'),
          vesting_duration: 31622400
        }
      ];

      // Act
      const result = accountConsolidationService._calculateVaultWeightedDates(
        subSchedules,
        3000
      );

      // Assert
      expect(result.cliffDate).toBeInstanceOf(Date);
      expect(result.endDate).toBeInstanceOf(Date);
      expect(result.duration).toBeGreaterThan(0);
      
      // Weighted average should be closer to second date (higher amount)
      const expectedCliffDate = new Date('2023-02-01'); // Weighted average
      expect(Math.abs(result.cliffDate.getTime() - expectedCliffDate.getTime())).toBeLessThan(86400000);
    });

    it('should handle empty sub-schedules', () => {
      // Act
      const result = accountConsolidationService._calculateVaultWeightedDates([], 1000);

      // Assert
      expect(result.cliffDate).toBeNull();
      expect(result.endDate).toBeNull();
      expect(result.duration).toBe(0);
    });

    it('should handle zero allocation', () => {
      // Arrange
      const subSchedules = [{
        top_up_amount: '1000',
        cliff_date: new Date('2023-01-01'),
        end_timestamp: new Date('2024-01-01'),
        vesting_duration: 31536000
      }];

      // Act
      const result = accountConsolidationService._calculateVaultWeightedDates(subSchedules, 0);

      // Assert
      expect(result.cliffDate).toBeNull();
      expect(result.endDate).toBeNull();
      expect(result.duration).toBe(0);
    });
  });

  afterAll(async () => {
    // Clean up test database
    await sequelize.close();
  });
});
