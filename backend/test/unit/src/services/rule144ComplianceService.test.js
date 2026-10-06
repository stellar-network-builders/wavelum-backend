/**
 * Tests for Rule144ComplianceService
 */

const rule144ComplianceService = require('./rule144ComplianceService');
const { Rule144Compliance, Vault, SubSchedule } = require('../models');
const { sequelize } = require('../database/connection');

describe('Rule144ComplianceService', () => {
  let testVault, testSubSchedule;

  beforeAll(async () => {
    // Setup test database
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    // Clean up test database
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await Rule144Compliance.destroy({ where: {} });
    await Vault.destroy({ where: {} });
    await SubSchedule.destroy({ where: {} });

    // Create test vault
    testVault = await Vault.create({
      address: '0x1234567890123456789012345678901234567890',
      name: 'Test Vault',
      token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      owner_address: '0xownerownerownerownerownerownerownerowner',
      total_amount: '1000000',
      org_id: null
    });

    // Create test subschedule
    testSubSchedule = await SubSchedule.create({
      vault_id: testVault.id,
      beneficiary_address: '0xuseruseruseruseruseruseruseruseruseruser',
      vesting_start_date: new Date('2024-01-01'),
      vesting_duration: 365 * 24 * 60 * 60, // 1 year in seconds
      cliff_date: new Date('2024-01-01'),
      top_up_amount: '1000'
    });
  });

  describe('createComplianceRecord', () => {
    test('should create compliance record successfully', async () => {
      const complianceRecord = await rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2024-01-01'),
        holdingPeriodMonths: 6,
        totalAmountAcquired: '1000'
      });

      expect(complianceRecord).toBeDefined();
      expect(complianceRecord.vault_id).toBe(testVault.id);
      expect(complianceRecord.user_address).toBe('0xuseruseruseruseruseruseruseruseruseruser');
      expect(complianceRecord.holding_period_months).toBe(6);
      expect(complianceRecord.is_restricted_security).toBe(true);
      expect(complianceRecord.compliance_status).toBe('RESTRICTED');
    });

    test('should throw error if record already exists', async () => {
      await rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2024-01-01')
      });

      await expect(rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2024-01-01')
      })).rejects.toThrow('already exists');
    });
  });

  describe('checkClaimCompliance', () => {
    test('should block claim for restricted security before holding period', async () => {
      // Create compliance record with 6-month holding period
      await rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2024-01-01'),
        holdingPeriodMonths: 6,
        totalAmountAcquired: '1000'
      });

      const complianceCheck = await rule144ComplianceService.checkClaimCompliance(
        testVault.id,
        '0xuseruseruseruseruseruseruseruseruseruser',
        new Date('2024-03-01') // 2 months after acquisition
      );

      expect(complianceCheck.isCompliant).toBe(false);
      expect(complianceCheck.complianceStatus).toBe('RESTRICTED');
      expect(complianceCheck.daysUntilCompliance).toBeGreaterThan(0);
      expect(complianceCheck.message).toContain('Claim is restricted');
    });

    test('should allow claim after holding period is met', async () => {
      await rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2024-01-01'),
        holdingPeriodMonths: 6,
        totalAmountAcquired: '1000'
      });

      const complianceCheck = await rule144ComplianceService.checkClaimCompliance(
        testVault.id,
        '0xuseruseruseruseruseruseruseruseruseruser',
        new Date('2024-07-01') // 6 months after acquisition
      );

      expect(complianceCheck.isCompliant).toBe(true);
      expect(complianceCheck.complianceStatus).toBe('COMPLIANT');
      expect(complianceCheck.daysUntilCompliance).toBe(0);
      expect(complianceCheck.message).toContain('compliant');
    });

    test('should auto-create compliance record if none exists', async () => {
      const complianceCheck = await rule144ComplianceService.checkClaimCompliance(
        testVault.id,
        '0xuseruseruseruseruseruseruseruseruseruser',
        new Date('2024-03-01')
      );

      expect(complianceCheck.isCompliant).toBe(false);
      expect(complianceCheck.complianceStatus).toBe('RESTRICTED');

      // Verify record was created
      const record = await Rule144Compliance.getComplianceByVaultAndUser(
        testVault.id,
        '0xuseruseruseruseruseruseruseruseruseruser'
      );
      expect(record).toBeDefined();
      expect(record.vault_id).toBe(testVault.id);
    });
  });

  describe('recordClaimAttempt', () => {
    test('should record compliant claim successfully', async () => {
      await rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2024-01-01'),
        holdingPeriodMonths: 6,
        totalAmountAcquired: '1000'
      });

      const updatedRecord = await rule144ComplianceService.recordClaimAttempt(
        testVault.id,
        '0xuseruseruseruseruseruseruseruseruseruser',
        '100',
        new Date('2024-07-01') // After holding period
      );

      expect(updatedRecord.amount_withdrawn_compliant).toBe('100');
      expect(updatedRecord.amount_withdrawn_restricted).toBe('0');
      expect(updatedRecord.last_claim_attempt_date).toBeDefined();
    });

    test('should record restricted claim with warning', async () => {
      await rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2024-01-01'),
        holdingPeriodMonths: 6,
        totalAmountAcquired: '1000'
      });

      const updatedRecord = await rule144ComplianceService.recordClaimAttempt(
        testVault.id,
        '0xuseruseruseruseruseruseruseruseruseruser',
        '100',
        new Date('2024-03-01') // Before holding period
      );

      expect(updatedRecord.amount_withdrawn_compliant).toBe('0');
      expect(updatedRecord.amount_withdrawn_restricted).toBe('100');
      expect(updatedRecord.last_claim_attempt_date).toBeDefined();
    });
  });

  describe('getVaultComplianceStatus', () => {
    test('should return compliance status for all users in vault', async () => {
      // Create multiple compliance records
      await rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuser1user1user1user1user1user1user1',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2024-01-01'),
        holdingPeriodMonths: 6,
        totalAmountAcquired: '1000'
      });

      await rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuser2user2user2user2user2user2user2',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2023-01-01'), // 1 year ago
        holdingPeriodMonths: 6,
        totalAmountAcquired: '2000'
      });

      const complianceStatus = await rule144ComplianceService.getVaultComplianceStatus(testVault.id);

      expect(complianceStatus).toHaveLength(2);
      expect(complianceStatus[0].userAddress).toBe('0xuser1user1user1user1user1user1user1');
      expect(complianceStatus[0].isCompliant).toBe(false);
      expect(complianceStatus[1].userAddress).toBe('0xuser2user2user2user2user2user2user2');
      expect(complianceStatus[1].isCompliant).toBe(true);
    });
  });

  describe('getComplianceStatistics', () => {
    test('should return compliance statistics', async () => {
      // Create test compliance records
      await rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuser1user1user1user1user1user1user1',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2024-01-01'),
        holdingPeriodMonths: 6,
        totalAmountAcquired: '1000'
      });

      await rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuser2user2user2user2user2user2user2',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2023-01-01'),
        holdingPeriodMonths: 6,
        totalAmountAcquired: '2000'
      });

      const stats = await rule144ComplianceService.getComplianceStatistics();

      expect(stats.total).toBe(2);
      expect(stats.restricted).toBe(1);
      expect(stats.compliant).toBe(1);
      expect(stats.restrictedSecurities).toBe(2);
      expect(stats.complianceRate).toBe('50.00');
    });
  });

  describe('updateComplianceRecord', () => {
    test('should update compliance record successfully', async () => {
      const record = await rule144ComplianceService.createComplianceRecord({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        tokenAddress: testVault.token_address,
        acquisitionDate: new Date('2024-01-01'),
        holdingPeriodMonths: 6,
        totalAmountAcquired: '1000'
      });

      const updatedRecord = await rule144ComplianceService.updateComplianceRecord(
        testVault.id,
        '0xuseruseruseruseruseruseruseruseruseruser',
        {
          holding_period_months: 12,
          exemption_type: 'RULE144A',
          notes: 'Updated by admin'
        },
        '0xadminadminadminadminadminadminadmin'
      );

      expect(updatedRecord.holding_period_months).toBe(12);
      expect(updatedRecord.exemption_type).toBe('RULE144A');
      expect(updatedRecord.notes).toBe('Updated by admin');
      expect(updatedRecord.verified_by).toBe('0xadminadminadminadminadminadminadmin');
      expect(updatedRecord.verification_date).toBeDefined();
    });
  });
});
