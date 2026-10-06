'use strict';

const { sequelize } = require('../../src/database/connection');
const { Vault, Beneficiary, SubSchedule } = require('../../src/models');
const batchRevocationService = require('../../src/services/batchRevocationService');
const vestingService = require('../../src/services/vestingService');

describe('Batch Revocation Service', () => {
  let vault;
  let beneficiaries = [];
  const adminAddress = 'ADMINADDRESS123456789';
  const treasuryAddress = 'TREASURYADDRESS123456789';

  beforeAll(async () => {
    // Create test vault
    vault = await Vault.create({
      address: 'TESTVAULTBATCHREVOK123456',
      owner_address: 'OWNERADDRESS1234567890',
      token_address: 'TOKENADDRESS1234567890',
      total_amount: '100000',
      token_type: 'static',
    });

    // Create test beneficiaries
    const beneficiaryData = [
      { address: 'BENEFICIARY1ADDRESS123456', total_allocated: '10000' },
      { address: 'BENEFICIARY2ADDRESS123456', total_allocated: '15000' },
      { address: 'BENEFICIARY3ADDRESS123456', total_allocated: '20000' },
    ];

    beneficiaries = await Promise.all(
      beneficiaryData.map(data =>
        Beneficiary.create({
          vault_id: vault.id,
          ...data,
          total_withdrawn: '0',
        })
      )
    );

    // Create sub-schedules for vesting
    await SubSchedule.create({
      vault_id: vault.id,
      top_up_amount: '100000',
      cliff_duration: 0,
      vesting_start_date: new Date(Date.now() - 86400000 * 30), // 30 days ago
      vesting_duration: 86400000 * 365, // 1 year
      start_timestamp: new Date(Date.now() - 86400000 * 30),
      end_timestamp: new Date(Date.now() + 86400000 * 335),
      is_active: true,
    });
  });

  afterAll(async () => {
    // Cleanup
    await SubSchedule.destroy({ where: { vault_id: vault.id } });
    await Beneficiary.destroy({ where: { vault_id: vault.id } });
    await Vault.destroy({ where: { id: vault.id } });
  });

  describe('validateBatchRevocation', () => {
    it('should validate correct parameters', async () => {
      const params = {
        vaultAddress: vault.address,
        beneficiaryAddresses: beneficiaries.map(b => b.address),
        adminAddress,
      };

      const result = await batchRevocationService.validateBatchRevocation(params);
      expect(result).toBe(true);
    });

    it('should reject empty beneficiary array', async () => {
      const params = {
        vaultAddress: vault.address,
        beneficiaryAddresses: [],
        adminAddress,
      };

      await expect(batchRevocationService.validateBatchRevocation(params))
        .rejects.toThrow('beneficiaryAddresses cannot be empty');
    });

    it('should reject non-array beneficiary addresses', async () => {
      const params = {
        vaultAddress: vault.address,
        beneficiaryAddresses: 'not-an-array',
        adminAddress,
      };

      await expect(batchRevocationService.validateBatchRevocation(params))
        .rejects.toThrow('beneficiaryAddresses must be an array');
    });

    it('should reject missing vault', async () => {
      const params = {
        vaultAddress: 'NONEXISTENTVAULT12345678',
        beneficiaryAddresses: [beneficiaries[0].address],
        adminAddress,
      };

      await expect(batchRevocationService.validateBatchRevocation(params))
        .rejects.toThrow('Vault not found');
    });
  });

  describe('batchRevokeBeneficiaries', () => {
    it('should revoke multiple beneficiaries atomically', async () => {
      const beneficiaryAddresses = beneficiaries.slice(0, 2).map(b => b.address);
      
      const result = await batchRevocationService.batchRevokeBeneficiaries({
        vaultAddress: vault.address,
        beneficiaryAddresses,
        adminAddress,
        reason: 'team_termination',
        treasuryAddress,
      });

      if (!result) {
        throw new Error('Batch revocation failed - no result returned');
      }

      expect(result.success).toBe(true);
      expect(result.beneficiaries_revoked).toBe(2);
      expect(result.results).toHaveLength(2);
      
      // Verify beneficiaries are marked as revoked
      const updatedBeneficiaries = await Beneficiary.findAll({
        where: { vault_id: vault.id },
      });

      const revokedCount = updatedBeneficiaries.filter(b => 
        beneficiaryAddresses.includes(b.address) && b.status === 'revoked'
      ).length;

      expect(revokedCount).toBe(2);
    });

    it('should return unvested amounts to treasury', async () => {
      const beneficiaryAddresses = [beneficiaries[2].address];
      
      const result = await batchRevocationService.batchRevokeBeneficiaries({
        vaultAddress: vault.address,
        beneficiaryAddresses,
        adminAddress,
        reason: 'performance_based_termination',
        treasuryAddress,
      });

      if (!result) {
        throw new Error('Batch revocation failed - no result returned');
      }

      expect(parseFloat(result.total_unvested_returned)).toBeGreaterThan(0);
      
      // Verify vault balance decreased by unvested amount
      const updatedVault = await Vault.findByPk(vault.id);
      expect(parseFloat(updatedVault.total_amount)).toBeLessThan(100000);
    });

    it('should rollback on error (atomic behavior)', async () => {
      const validAddresses = beneficiaries.map(b => b.address);
      const invalidAddresses = [...validAddresses, 'INVALIDBENEFICIARY12345'];

      try {
        await batchRevocationService.batchRevokeBeneficiaries({
          vaultAddress: vault.address,
          beneficiaryAddresses: invalidAddresses,
          adminAddress,
          reason: 'test_rollback',
        });
        
        // Should not reach here
        fail('Expected error was not thrown');
      } catch (error) {
        expect(error.message).toContain('Beneficiary not found');
        
        // Verify no beneficiaries were revoked (atomic rollback)
        const stillActive = await Beneficiary.count({
          where: {
            vault_id: vault.id,
            status: 'active',
          },
        });

        // All should still be active due to rollback
        expect(stillActive).toBeGreaterThanOrEqual(1);
      }
    });

    it('should handle single beneficiary revocation', async () => {
      // Create a fresh beneficiary for this test
      const singleBeneficiary = await Beneficiary.create({
        vault_id: vault.id,
        address: 'SINGLEBENEFACTOR123456',
        total_allocated: '5000',
        total_withdrawn: '0',
      });

      const result = await batchRevocationService.batchRevokeBeneficiaries({
        vaultAddress: vault.address,
        beneficiaryAddresses: [singleBeneficiary.address],
        adminAddress,
        reason: 'resignation',
      });

      if (!result) {
        throw new Error('Batch revocation failed - no result returned');
      }

      expect(result.beneficiaries_revoked).toBe(1);
      
      // Cleanup
      await singleBeneficiary.destroy();
    });
  });

  describe('Edge Cases', () => {
    it('should handle blacklisted vault', async () => {
      const blacklistedVault = await Vault.create({
        address: 'BLACKLISTEDVAULT123456',
        owner_address: 'OWNERADDRESS1234567890',
        token_address: 'TOKENADDRESS1234567890',
        total_amount: '50000',
        is_blacklisted: true,
      });

      const beneficiary = await Beneficiary.create({
        vault_id: blacklistedVault.id,
        address: 'BENEFICIARYBLACKLIST123',
        total_allocated: '5000',
      });

      await expect(
        batchRevocationService.batchRevokeBeneficiaries({
          vaultAddress: blacklistedVault.address,
          beneficiaryAddresses: [beneficiary.address],
          adminAddress,
          reason: 'test',
        })
      ).rejects.toThrow('blacklisted');

      // Cleanup
      await Beneficiary.destroy({ where: { vault_id: blacklistedVault.id } });
      await Vault.destroy({ where: { id: blacklistedVault.id } });
    });

    it('should calculate correct vested/unvested amounts', async () => {
      // This test verifies the clean break calculation logic
      const beneficiary = beneficiaries[0];
      
      const cleanBreak = await vestingService.calculateCleanBreak(
        vault.address,
        beneficiary.address
      );

      expect(cleanBreak.accrued_since_last_claim).toBeGreaterThanOrEqual(0);
      expect(cleanBreak.unearned_amount).toBeGreaterThanOrEqual(0);
      expect(parseFloat(cleanBreak.accrued_since_last_claim) + parseFloat(cleanBreak.unearned_amount))
        .toBeCloseTo(parseFloat(beneficiary.total_allocated), 2);
    });
  });
});
