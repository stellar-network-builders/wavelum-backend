const futureLienService = require('../src/services/futureLienService');
const { Vault, Beneficiary, GrantStream, FutureLien, LienRelease, LienMilestone } = require('../src/models');
const { sequelize } = require('../src/database/connection');

describe('Future Lien Service Unit Tests', () => {
  let testVault;
  let testBeneficiary;
  let testGrantStream;
  let testUserAddress = '0x1234567890123456789012345678901234567890';

  beforeAll(async () => {
    await sequelize.sync({ force: true });
    
    // Create test data
    testVault = await Vault.create({
      address: '0x9876543210987654321098765432109876543210',
      owner_address: testUserAddress,
      token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      total_amount: '1000',
      token_type: 'static'
    });

    testBeneficiary = await Beneficiary.create({
      vault_id: testVault.id,
      address: testUserAddress,
      total_allocated: '500'
    });

    testGrantStream = await GrantStream.create({
      address: '0x1111111111111111111111111111111111111111',
      name: 'Test Grant Stream',
      description: 'A test grant stream',
      owner_address: '0x2222222222222222222222222222222222222222',
      token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      target_amount: '10000',
      is_active: true
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('createFutureLien', () => {
    test('should create a future lien successfully', async () => {
      const lienData = {
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 100,
        release_start_date: new Date(Date.now() + 86400000),
        release_end_date: new Date(Date.now() + 86400000 * 365),
        release_rate_type: 'linear',
        transaction_hash: '0x' + 'a'.repeat(64)
      };

      const result = await futureLienService.createFutureLien(lienData, testUserAddress);

      expect(result.success).toBe(true);
      expect(result.lien.vault_address).toBe(testVault.address);
      expect(result.lien.beneficiary_address).toBe(testUserAddress);
      expect(result.lien.committed_amount).toBe('100');
      expect(result.lien.status).toBe('pending');
    });

    test('should create a future lien with milestones', async () => {
      const lienData = {
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 200,
        release_start_date: new Date(Date.now() + 86400000),
        release_end_date: new Date(Date.now() + 86400000 * 365),
        release_rate_type: 'milestone',
        milestones: [
          {
            name: 'Milestone 1',
            percentage_of_total: 50,
            target_date: new Date(Date.now() + 86400000 * 90)
          },
          {
            name: 'Milestone 2',
            percentage_of_total: 50,
            target_date: new Date(Date.now() + 86400000 * 180)
          }
        ]
      };

      const result = await futureLienService.createFutureLien(lienData, testUserAddress);

      expect(result.success).toBe(true);
      expect(result.lien.milestones).toHaveLength(2);
      expect(result.lien.milestones[0].percentage_of_total).toBe('50');
    });

    test('should throw error for non-existent vault', async () => {
      const lienData = {
        vault_address: '0xnonexistent',
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 100,
        release_start_date: new Date(Date.now() + 86400000),
        release_end_date: new Date(Date.now() + 86400000 * 365),
        release_rate_type: 'linear'
      };

      await expect(futureLienService.createFutureLien(lienData, testUserAddress))
        .rejects.toThrow('Vault not found');
    });

    test('should throw error for inactive grant stream', async () => {
      // Create inactive grant stream
      const inactiveGrantStream = await GrantStream.create({
        address: '0x9999999999999999999999999999999999999999',
        name: 'Inactive Grant Stream',
        owner_address: testUserAddress,
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        is_active: false
      });

      const lienData = {
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: inactiveGrantStream.id,
        committed_amount: 100,
        release_start_date: new Date(Date.now() + 86400000),
        release_end_date: new Date(Date.now() + 86400000 * 365),
        release_rate_type: 'linear'
      };

      await expect(futureLienService.createFutureLien(lienData, testUserAddress))
        .rejects.toThrow('is not active');
    });

    test('should throw error for invalid milestone percentages', async () => {
      const lienData = {
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 100,
        release_start_date: new Date(Date.now() + 86400000),
        release_end_date: new Date(Date.now() + 86400000 * 365),
        release_rate_type: 'milestone',
        milestones: [
          {
            name: 'Milestone 1',
            percentage_of_total: 60, // Total will be 110%
          },
          {
            name: 'Milestone 2',
            percentage_of_total: 50
          }
        ]
      };

      await expect(futureLienService.createFutureLien(lienData, testUserAddress))
        .rejects.toThrow('must sum to 100%');
    });
  });

  describe('getBeneficiaryLiens', () => {
    beforeEach(async () => {
      // Create a test lien for retrieval tests
      await futureLienService.createFutureLien({
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 100,
        release_start_date: new Date(Date.now() + 86400000),
        release_end_date: new Date(Date.now() + 86400000 * 365),
        release_rate_type: 'linear'
      }, testUserAddress);
    });

    test('should get liens for beneficiary', async () => {
      const liens = await futureLienService.getBeneficiaryLiens(testUserAddress);

      expect(liens).toBeInstanceOf(Array);
      expect(liens.length).toBeGreaterThan(0);
      expect(liens[0].beneficiary_address).toBe(testUserAddress);
      expect(liens[0].available_for_release).toBeDefined();
      expect(liens[0].remaining_amount).toBeDefined();
    });

    test('should filter liens by status', async () => {
      const liens = await futureLienService.getBeneficiaryLiens(testUserAddress, {
        status: 'pending'
      });

      expect(liens.every(lien => lien.status === 'pending')).toBe(true);
    });

    test('should exclude inactive liens by default', async () => {
      // Create an inactive lien
      const result = await futureLienService.createFutureLien({
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 50,
        release_start_date: new Date(Date.now() + 86400000),
        release_end_date: new Date(Date.now() + 86400000 * 365),
        release_rate_type: 'linear'
      }, testUserAddress);

      // Cancel the lien to make it inactive
      await futureLienService.cancelFutureLien(result.lien.id, testUserAddress);

      const liens = await futureLienService.getBeneficiaryLiens(testUserAddress);
      const cancelledLien = liens.find(lien => lien.id === result.lien.id);
      expect(cancelledLien).toBeUndefined();
    });
  });

  describe('processLienRelease', () => {
    let testLien;

    beforeEach(async () => {
      // Create a test lien with immediate release
      const result = await futureLienService.createFutureLien({
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 100,
        release_start_date: new Date(Date.now() - 86400000), // Yesterday
        release_end_date: new Date(Date.now() + 86400000), // Tomorrow
        release_rate_type: 'immediate'
      }, testUserAddress);
      
      testLien = result.lien;
    });

    test('should process a lien release successfully', async () => {
      const releaseData = {
        lien_id: testLien.id,
        amount: 50,
        transaction_hash: '0x' + 'b'.repeat(64),
        block_number: 12345
      };

      const result = await futureLienService.processLienRelease(releaseData, testUserAddress);

      expect(result.success).toBe(true);
      expect(result.release.amount).toBe('50');
      expect(result.lien.released_amount).toBe('50');
      expect(result.lien.status).toBe('active');
    });

    test('should complete lien when full amount is released', async () => {
      const releaseData = {
        lien_id: testLien.id,
        amount: 100, // Full amount
        transaction_hash: '0x' + 'c'.repeat(64)
      };

      const result = await futureLienService.processLienRelease(releaseData, testUserAddress);

      expect(result.lien.status).toBe('completed');
    });

    test('should throw error for non-existent lien', async () => {
      const releaseData = {
        lien_id: 99999,
        amount: 50
      };

      await expect(futureLienService.processLienRelease(releaseData, testUserAddress))
        .rejects.toThrow('Lien not found');
    });

    test('should throw error for cancelled lien', async () => {
      // Cancel the lien first
      await futureLienService.cancelFutureLien(testLien.id, testUserAddress);

      const releaseData = {
        lien_id: testLien.id,
        amount: 50
      };

      await expect(futureLienService.processLienRelease(releaseData, testUserAddress))
        .rejects.toThrow('is cancelled');
    });
  });

  describe('processMilestoneRelease', () => {
    let testLien;

    beforeEach(async () => {
      // Create a test lien with milestones
      const result = await futureLienService.createFutureLien({
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 200,
        release_start_date: new Date(Date.now() - 86400000),
        release_end_date: new Date(Date.now() + 86400000 * 365),
        release_rate_type: 'milestone',
        milestones: [
          {
            name: 'Milestone 1',
            percentage_of_total: 50,
            target_date: new Date(Date.now() - 86400000) // Past date
          },
          {
            name: 'Milestone 2',
            percentage_of_total: 50,
            target_date: new Date(Date.now() + 86400000 * 90) // Future date
          }
        ]
      }, testUserAddress);
      
      testLien = result.lien;
    });

    test('should process milestone release', async () => {
      const milestone = testLien.milestones[0]; // First milestone
      
      const releaseData = {
        lien_id: testLien.id,
        milestone_id: milestone.id,
        transaction_hash: '0x' + 'd'.repeat(64)
      };

      const result = await futureLienService.processLienRelease(releaseData, testUserAddress);

      expect(result.success).toBe(true);
      expect(result.release.amount).toBe('100'); // 50% of 200
    });

    test('should throw error for completed milestone', async () => {
      const milestone = testLien.milestones[0];
      
      // Process the milestone once
      await futureLienService.processLienRelease({
        lien_id: testLien.id,
        milestone_id: milestone.id
      }, testUserAddress);

      // Try to process again
      await expect(futureLienService.processLienRelease({
        lien_id: testLien.id,
        milestone_id: milestone.id
      }, testUserAddress)).rejects.toThrow('already completed');
    });
  });

  describe('cancelFutureLien', () => {
    let testLien;

    beforeEach(async () => {
      const result = await futureLienService.createFutureLien({
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 100,
        release_start_date: new Date(Date.now() + 86400000),
        release_end_date: new Date(Date.now() + 86400000 * 365),
        release_rate_type: 'linear'
      }, testUserAddress);
      
      testLien = result.lien;
    });

    test('should cancel a future lien successfully', async () => {
      const result = await futureLienService.cancelFutureLien(testLien.id, testUserAddress, 'Test cancellation');

      expect(result.success).toBe(true);
      expect(result.lien.status).toBe('cancelled');
      expect(result.lien.is_active).toBe(false);
    });

    test('should throw error for already cancelled lien', async () => {
      await futureLienService.cancelFutureLien(testLien.id, testUserAddress);

      await expect(futureLienService.cancelFutureLien(testLien.id, testUserAddress))
        .rejects.toThrow('already cancelled');
    });

    test('should throw error for completed lien', async () => {
      // Complete the lien first
      await futureLienService.processLienRelease({
        lien_id: testLien.id,
        amount: 100
      }, testUserAddress);

      await expect(futureLienService.cancelFutureLien(testLien.id, testUserAddress))
        .rejects.toThrow('Cannot cancel completed lien');
    });
  });

  describe('createGrantStream', () => {
    test('should create a grant stream successfully', async () => {
      const grantStreamData = {
        address: '0x5555555555555555555555555555555555555555',
        name: 'New Grant Stream',
        description: 'A new grant stream',
        owner_address: testUserAddress,
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        target_amount: 5000
      };

      const result = await futureLienService.createGrantStream(grantStreamData, testUserAddress);

      expect(result.success).toBe(true);
      expect(result.grant_stream.name).toBe('New Grant Stream');
      expect(result.grant_stream.is_active).toBe(true);
      expect(result.grant_stream.current_amount).toBe('0');
    });

    test('should throw error for duplicate address', async () => {
      const grantStreamData = {
        address: testGrantStream.address, // Same as existing
        name: 'Duplicate Grant Stream',
        owner_address: testUserAddress,
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
      };

      await expect(futureLienService.createGrantStream(grantStreamData, testUserAddress))
        .rejects.toThrow();
    });
  });

  describe('getActiveLienSummary', () => {
    beforeEach(async () => {
      // Create multiple test liens
      await futureLienService.createFutureLien({
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 100,
        release_start_date: new Date(Date.now() - 86400000),
        release_end_date: new Date(Date.now() + 86400000 * 30),
        release_rate_type: 'linear'
      }, testUserAddress);

      await futureLienService.createFutureLien({
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 150,
        release_start_date: new Date(Date.now() + 86400000),
        release_end_date: new Date(Date.now() + 86400000 * 60),
        release_rate_type: 'immediate'
      }, testUserAddress);
    });

    test('should get active lien summary', async () => {
      const summary = await futureLienService.getActiveLienSummary();

      expect(summary).toBeInstanceOf(Array);
      expect(summary.length).toBeGreaterThan(0);
      
      // Check calculated fields
      const lien = summary[0];
      expect(lien.available_for_release).toBeDefined();
      expect(lien.remaining_amount).toBeDefined();
      expect(lien.is_within_release_period).toBeDefined();
      expect(lien.days_until_release_start).toBeDefined();
      expect(lien.days_until_release_end).toBeDefined();
    });

    test('should filter summary by vault address', async () => {
      const summary = await futureLienService.getActiveLienSummary({
        vault_address: testVault.address
      });

      expect(summary.every(lien => lien.vault_address === testVault.address)).toBe(true);
    });

    test('should filter summary by beneficiary address', async () => {
      const summary = await futureLienService.getActiveLienSummary({
        beneficiary_address: testUserAddress
      });

      expect(summary.every(lien => lien.beneficiary_address === testUserAddress)).toBe(true);
    });
  });
});
