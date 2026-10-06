const request = require('supertest');
const { sequelize } = require('../src/database/connection');
const { Vault, SubSchedule, Beneficiary } = require('../src/models');
const vestingService = require('../src/services/vestingService');

jest.setTimeout(60000);

describe('Vesting Service Tests', () => {
  beforeAll(async () => {
    await sequelize.sync({ force: true });
  });



  beforeEach(async () => {
    await Vault.destroy({ where: {}, force: true });
    await SubSchedule.destroy({ where: {}, force: true });
    await Beneficiary.destroy({ where: {}, force: true });
  });

  describe('Vault Creation', () => {
    test('should create a vault with beneficiaries', async () => {
      const vaultData = {
        address: '0x1234567890123456789012345678901234567890',
        name: 'Test Vault',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        owner_address: '0x1111111111111111111111111111111111111111',
        initial_amount: '1000',
        beneficiaries: [
          {
            address: '0x2222222222222222222222222222222222222222',
            allocation: '500'
          }
        ]
      };

      const vault = await vestingService.createVault(vaultData);

      expect(vault.address).toBe(vaultData.address);
      expect(vault.name).toBe(vaultData.name);
      expect(parseFloat(vault.total_amount)).toBe(1000);

      const beneficiaries = await Beneficiary.findAll({ where: { vault_id: vault.id } });
      expect(beneficiaries).toHaveLength(1);
      expect(beneficiaries[0].address).toBe('0x2222222222222222222222222222222222222222');
      expect(parseFloat(beneficiaries[0].total_allocated)).toBe(500);
    });
  });

  describe('Top-up Processing', () => {
    let vault;

    beforeEach(async () => {
      vault = await vestingService.createVault({
        address: '0x1234567890123456789012345678901234567890',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        owner_address: '0x1111111111111111111111111111111111111111'
      });
    });

    test('should process a top-up with cliff', async () => {
      const topUpData = {
        vault_address: vault.address,
        amount: '500',
        cliff_duration_seconds: 86400, // 1 day
        vesting_duration_seconds: 2592000, // 30 days
        transaction_hash: '0xabcdef1234567890',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z')
      };

      const subSchedule = await vestingService.processTopUp(topUpData);

      expect(subSchedule.vault_id).toBe(vault.id);
      expect(parseFloat(subSchedule.top_up_amount)).toBe(500);
      expect(subSchedule.cliff_duration).toBe(86400);
      expect(subSchedule.vesting_duration).toBe(2592000);
      expect(subSchedule.start_timestamp).toEqual(new Date('2024-01-02T00:00:00Z'));
      expect(subSchedule.end_timestamp).toEqual(new Date('2024-02-01T00:00:00Z'));

      // Check vault total amount updated
      const updatedVault = await Vault.findByPk(vault.id);
      expect(parseFloat(updatedVault.total_amount)).toBe(500);
    });

    test('should process multiple top-ups with different cliffs', async () => {
      // First top-up
      await vestingService.processTopUp({
        vault_address: vault.address,
        amount: '1000',
        cliff_duration_seconds: 86400, // 1 day
        vesting_duration_seconds: 2592000, // 30 days
        transaction_hash: '0xabcdef1234567890',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z')
      });

      // Second top-up with different cliff
      await vestingService.processTopUp({
        vault_address: vault.address,
        amount: '500',
        cliff_duration_seconds: 172800, // 2 days
        vesting_duration_seconds: 5184000, // 60 days
        transaction_hash: '0x1234567890abcdef',
        block_number: 12346,
        timestamp: new Date('2024-01-15T00:00:00Z')
      });

      const schedule = await vestingService.getVestingSchedule(vault.address);
      expect(schedule.subSchedules).toHaveLength(2);
      expect(parseFloat(schedule.subSchedules[0].top_up_amount)).toBe(1000);
      expect(parseFloat(schedule.subSchedules[1].top_up_amount)).toBe(500);
    });
  });

  describe('Vesting Calculations', () => {
    let vault, beneficiary;

    beforeEach(async () => {
      vault = await vestingService.createVault({
        address: '0x1234567890123456789012345678901234567890',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        owner_address: '0x1111111111111111111111111111111111111111',
        beneficiaries: [
          {
            address: '0x2222222222222222222222222222222222222222',
            allocation: '1500'
          }
        ]
      });

      beneficiary = await Beneficiary.findOne({ where: { vault_id: vault.id } });
    });

    test('should calculate zero vested before cliff', async () => {
      await vestingService.processTopUp({
        vault_address: vault.address,
        amount: '1000',
        cliff_duration_seconds: 86400, // 1 day
        vesting_duration_seconds: 2592000, // 30 days
        transaction_hash: '0xabcdef1234567890',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z')
      });

      const vestingInfo = await vestingService.calculateWithdrawableAmount(
        vault.address,
        beneficiary.address,
        new Date('2024-01-01T12:00:00Z') // Before cliff
      );

      expect(vestingInfo.withdrawable).toBe(0);
      expect(vestingInfo.total_vested).toBe(0);
    });

    test('should calculate partial vested during vesting period', async () => {
      await vestingService.processTopUp({
        vault_address: vault.address,
        amount: '1000',
        cliff_duration_seconds: 86400, // 1 day
        vesting_duration_seconds: 2592000, // 30 days
        transaction_hash: '0xabcdef1234567890',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z')
      });

      // 15 days into vesting (half way)
      const vestingInfo = await vestingService.calculateWithdrawableAmount(
        vault.address,
        beneficiary.address,
        new Date('2024-01-17T00:00:00Z')
      );

      expect(vestingInfo.total_vested).toBeCloseTo(500, 2); // Half of 1000
      expect(vestingInfo.withdrawable).toBeCloseTo(500, 2);
    });

    test('should calculate fully vested after vesting period', async () => {
      await vestingService.processTopUp({
        vault_address: vault.address,
        amount: '1000',
        cliff_duration_seconds: 86400, // 1 day
        vesting_duration_seconds: 2592000, // 30 days
        transaction_hash: '0xabcdef1234567890',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z')
      });

      const vestingInfo = await vestingService.calculateWithdrawableAmount(
        vault.address,
        beneficiary.address,
        new Date('2024-02-01T00:00:00Z') // After vesting period
      );

      expect(vestingInfo.total_vested).toBe(1000);
      expect(vestingInfo.withdrawable).toBe(1000);
    });
  });

  describe('Withdrawal Processing', () => {
    let vault, beneficiary;

    beforeEach(async () => {
      vault = await vestingService.createVault({
        address: '0x1234567890123456789012345678901234567890',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        owner_address: '0x1111111111111111111111111111111111111111',
        beneficiaries: [
          {
            address: '0x2222222222222222222222222222222222222222',
            allocation: '1500'
          }
        ]
      });

      beneficiary = await Beneficiary.findOne({ where: { vault_id: vault.id } });

      await vestingService.processTopUp({
        vault_address: vault.address,
        amount: '1000',
        cliff_duration_seconds: 0, // No cliff
        vesting_duration_seconds: 2592000, // 30 days
        transaction_hash: '0xabcdef1234567890',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z')
      });
    });

    test('should process successful withdrawal', async () => {
      const withdrawalData = {
        vault_address: vault.address,
        beneficiary_address: beneficiary.address,
        amount: '200',
        transaction_hash: '0xwithdraw123456',
        block_number: 12346,
        timestamp: new Date('2024-01-16T00:00:00Z') // Half vested
      };

      const result = await vestingService.processWithdrawal(withdrawalData);

      expect(result.success).toBe(true);
      expect(parseFloat(result.amount_withdrawn)).toBe(200);
      expect(result.distribution).toHaveLength(1);

      // Check beneficiary updated
      const updatedBeneficiary = await Beneficiary.findByPk(beneficiary.id);
      expect(parseFloat(updatedBeneficiary.total_withdrawn)).toBe(200);
    });

    test('should reject withdrawal exceeding vested amount', async () => {
      const withdrawalData = {
        vault_address: vault.address,
        beneficiary_address: beneficiary.address,
        amount: '600', // More than vested at this point
        transaction_hash: '0xwithdraw123456',
        block_number: 12346,
        timestamp: new Date('2024-01-16T00:00:00Z') // Half vested (500)
      };

      await expect(vestingService.processWithdrawal(withdrawalData))
        .rejects.toThrow('Insufficient vested amount');
    });
  });

  describe('Vault Summary', () => {
    test('should return comprehensive vault summary', async () => {
      const vault = await vestingService.createVault({
        address: '0x1234567890123456789012345678901234567890',
        name: 'Test Vault',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        owner_address: '0x1111111111111111111111111111111111111111',
        beneficiaries: [
          {
            address: '0x2222222222222222222222222222222222222222',
            allocation: '500'
          }
        ]
      });

      await vestingService.processTopUp({
        vault_address: vault.address,
        amount: '1000',
        cliff_duration_seconds: 86400,
        vesting_duration_seconds: 2592000,
        transaction_hash: '0xabcdef1234567890',
        block_number: 12345,
        timestamp: new Date('2024-01-01T00:00:00Z')
      });

      const summary = await vestingService.getVaultSummary(vault.address);

      expect(summary.vault_address).toBe(vault.address);
      expect(summary.token_address).toBe('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
      expect(parseFloat(summary.total_amount)).toBe(1000);
      expect(summary.total_top_ups).toBe(1);
      expect(summary.total_beneficiaries).toBe(1);
      expect(summary.sub_schedules).toHaveLength(1);
      expect(summary.beneficiaries).toHaveLength(1);
    });
  });
});
