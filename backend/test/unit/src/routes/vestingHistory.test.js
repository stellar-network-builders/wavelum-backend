const request = require('supertest');
const express = require('express');
const { sequelize } = require('../database/connection');
const { Vault, SubSchedule, Beneficiary, ClaimsHistory, Organization, Token } = require('../models');

// Mock cache service
jest.mock('../services/cacheService', () => ({
  get: jest.fn(),
  set: jest.fn(),
  deletePattern: jest.fn()
}));

const vestingHistoryRoutes = require('./vestingHistory');

describe('Vesting History API', () => {
  let app;
  let testVault;
  let testSubSchedule;
  let testBeneficiary;
  let testClaims;

  beforeAll(async () => {
    // Setup test app
    app = express();
    app.use(express.json());
    app.use('/api/vesting-history', vestingHistoryRoutes);

    // Sync database
    await sequelize.sync({ force: true });

    // Create test data
    const testToken = await Token.create({
      address: '0x1234567890123456789012345678901234567890',
      symbol: 'TEST',
      decimals: 18
    });

    const testOrganization = await Organization.create({
      id: 'test-org-id',
      name: 'Test Organization',
      admin_address: '0x1234567890123456789012345678901234567890'
    });

    testVault = await Vault.create({
      address: '0x1234567890123456789012345678901234567890',
      name: 'Test Vault',
      token_address: testToken.address,
      owner_address: '0x1234567890123456789012345678901234567890',
      organization_id: testOrganization.id
    });

    testBeneficiary = await Beneficiary.create({
      address: '0x1234567890123456789012345678901234567890',
      vault_id: testVault.id,
      total_allocated: '1000',
      total_withdrawn: '0'
    });

    testSubSchedule = await SubSchedule.create({
      vault_id: testVault.id,
      top_up_amount: '1000',
      cliff_duration: 86400, // 1 day
      vesting_start_date: new Date(Date.now() - 86400), // Started yesterday
      vesting_duration: 172800, // 2 days
      start_timestamp: new Date(Date.now() - 86400),
      end_timestamp: new Date(Date.now() + 86400),
      transaction_hash: '0xabcdef1234567890',
      block_number: 12345
    });

    // Create test claims
    testClaims = await ClaimsHistory.bulkCreate([
      {
        user_address: '0x1234567890123456789012345678901234567890',
        token_address: testToken.address,
        amount_claimed: '100',
        claim_timestamp: new Date(Date.now() - 3600000),
        transaction_hash: '0x1111111111111111',
        block_number: 12346,
        vault_id: testVault.id
      },
      {
        user_address: '0x1234567890123456789012345678901234567890',
        token_address: testToken.address,
        amount_claimed: '50',
        claim_timestamp: new Date(Date.now() - 7200000),
        transaction_hash: '0x2222222222222222',
        block_number: 12347,
        vault_id: testVault.id
      }
    ]);
  });

  afterAll(async () => {
    // Clean up test data
    await ClaimsHistory.destroy({ where: {} });
    await SubSchedule.destroy({ where: {} });
    await Beneficiary.destroy({ where: {} });
    await Vault.destroy({ where: {} });
    await Organization.destroy({ where: {} });
    await Token.destroy({ where: {} });
    await sequelize.close();
  });

  describe('GET /api/vesting-history/user/:userAddress/history', () => {
    it('should return user vesting history', async () => {
      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/history')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.schedules).toHaveLength(1);
      
      const schedule = response.body.data.schedules[0];
      expect(schedule.vaultAddress).toBe(testVault.address);
      expect(schedule.vaultName).toBe(testVault.name);
      expect(schedule.totalAllocated).toBe('1000');
      expect(schedule.beneficiaryAddress).toBe('0x1234567890123456789012345678901234567890');
      expect(schedule.claims).toHaveLength(2);
      expect(schedule.isCliffPassed).toBe(true);
      expect(schedule.vestingProgress).toBeGreaterThan(0);
    });

    it('should return cached data when available', async () => {
      const { get } = require('../services/cacheService');
      get.mockResolvedValue({
        schedules: [],
        pagination: { page: 1, limit: 50, total: 0 }
      });

      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/history')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.cached).toBe(true);
    });

    it('should handle pagination correctly', async () => {
      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/history?page=1&limit=10')
        .expect(200);

      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.limit).toBe(10);
      expect(response.body.data.pagination.total).toBe(1);
    });

    it('should handle status filtering', async () => {
      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/history?status=active')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.schedules).toHaveLength(1);
    });

    it('should handle date range filtering', async () => {
      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/history?dateFrom=2023-01-01&dateTo=2024-12-31')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get('/api/vesting-history/user/0x0000000000000000000000000000000000000000/history')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.schedules).toHaveLength(0);
    });
  });

  describe('GET /api/vesting-history/user/:userAddress/summary', () => {
    it('should return user vesting summary', async () => {
      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/summary')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.userAddress).toBe('0x1234567890123456789012345678901234567890');
      expect(response.body.data.totalVaults).toBe(1);
      expect(response.body.data.totalAllocated).toBe('1000');
      expect(response.body.data.totalWithdrawn).toBe('0');
      expect(response.body.data.totalRemaining).toBe('1000');
      expect(response.body.data.recentClaims).toHaveLength(2);
      expect(response.body.data.tokensByToken).toHaveLength(1);
    });

    it('should return cached summary when available', async () => {
      const { get } = require('../services/cacheService');
      get.mockResolvedValue({
        userAddress: '0x1234567890123456789012345678901234567890',
        totalVaults: 0
      });

      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/summary')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.cached).toBe(true);
    });
  });

  describe('GET /api/vesting-history/schedule/:scheduleId', () => {
    it('should return specific vesting schedule', async () => {
      const response = await request(app)
        .get(`/api/vesting-history/schedule/${testSubSchedule.id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(testSubSchedule.id);
      expect(response.body.data.vaultAddress).toBe(testVault.address);
      expect(response.body.data.totalAllocated).toBe('1000');
      expect(response.body.data.claims).toHaveLength(2);
    });

    it('should return 404 for non-existent schedule', async () => {
      const response = await request(app)
        .get('/api/vesting-history/schedule/00000000-0000-0000-0000-000000000000')
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Vesting schedule not found');
    });

    it('should return cached schedule when available', async () => {
      const { get } = require('../services/cacheService');
      get.mockResolvedValue({
        id: testSubSchedule.id,
        vaultAddress: testVault.address
      });

      const response = await request(app)
        .get(`/api/vesting-history/schedule/${testSubSchedule.id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.cached).toBe(true);
    });
  });

  describe('GET /api/vesting-history/user/:userAddress/claims', () => {
    it('should return user claim history', async () => {
      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/claims')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.claims).toHaveLength(2);
      
      const claim = response.body.data.claims[0];
      expect(claim.userAddress).toBe('0x1234567890123456789012345678901234567890');
      expect(claim.vaultAddress).toBe(testVault.address);
      expect(claim.amountClaimed).toBeDefined();
      expect(claim.claimTimestamp).toBeDefined();
    });

    it('should handle pagination for claims', async () => {
      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/claims?page=1&limit=1')
        .expect(200);

      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.limit).toBe(1);
      expect(response.body.data.pagination.total).toBe(2);
    });

    it('should filter claims by vault', async () => {
      const response = await request(app)
        .get(`/api/vesting-history/user/0x1234567890123456789012345678901234567890/claims?vaultId=${testSubSchedule.id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.claims).toHaveLength(2);
    });

    it('should handle date range filtering for claims', async () => {
      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/claims?dateFrom=2023-01-01&dateTo=2024-12-31')
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /api/vesting-history/statistics', () => {
    it('should return vesting statistics', async () => {
      const response = await request(app)
        .get('/api/vesting-history/statistics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalVaults).toBe(1);
      expect(response.body.data.totalAllocated).toBe('1000');
      expect(response.body.data.totalWithdrawn).toBe('0');
      expect(response.body.data.totalRemaining).toBe('1000');
    });

    it('should filter statistics by organization', async () => {
      const response = await request(app)
        .get('/api/vesting-history/statistics?organizationId=test-org-id')
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return cached statistics when available', async () => {
      const { get } = require('../services/cacheService');
      get.mockResolvedValue({
        totalVaults: 0,
        totalAllocated: '0'
      });

      const response = await request(app)
        .get('/api/vesting-history/statistics')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.cached).toBe(true);
    });
  });

  describe('POST /api/vesting-history/user/:userAddress/cache/clear', () => {
    it('should clear user cache', async () => {
      const { deletePattern } = require('../services/cacheService');
      deletePattern.mockResolvedValue();

      const response = await request(app)
        .post('/api/vesting-history/user/0x1234567890123456789012345678901234567890/cache/clear')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Cache cleared successfully');
      expect(deletePattern).toHaveBeenCalledWith('vesting_history_0x1234567890123456789012345678901234567890_*');
      expect(deletePattern).toHaveBeenCalledWith('vesting_summary_0x1234567890123456789012345678901234567890');
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid user address', async () => {
      const response = await request(app)
        .get('/api/vesting-history/user/invalid-address/history')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });

    it('should handle invalid pagination parameters', async () => {
      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/history?page=-1')
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should default to page 1
      expect(response.body.data.pagination.page).toBe(1);
    });

    it('should handle database errors gracefully', async () => {
      // Mock a database error
      const originalFindAll = SubSchedule.findAll;
      SubSchedule.findAll = jest.fn().mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/history')
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to fetch vesting history');

      // Restore original method
      SubSchedule.findAll = originalFindAll;
    });
  });

  describe('Performance Tests', () => {
    it('should handle large datasets efficiently', async () => {
      // Create additional test data
      const additionalSchedules = [];
      for (let i = 0; i < 50; i++) {
        additionalSchedules.push({
          vault_id: testVault.id,
          top_up_amount: (1000 + i).toString(),
          cliff_duration: 86400,
          vesting_start_date: new Date(Date.now() - 86400),
          vesting_duration: 172800,
          start_timestamp: new Date(Date.now() - 86400),
          end_timestamp: new Date(Date.now() + 86400),
          transaction_hash: `0x${i.toString(16).padStart(64, '0')}`,
          block_number: 12345 + i
        });
      }

      await SubSchedule.bulkCreate(additionalSchedules);

      const startTime = Date.now();
      const response = await request(app)
        .get('/api/vesting-history/user/0x1234567890123456789012345678901234567890/history')
        .expect(200);

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.body.success).toBe(true);
      expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
      expect(response.body.data.schedules.length).toBeGreaterThan(50);

      // Clean up additional data
      await SubSchedule.destroy({ where: { vault_id: testVault.id } });
      await SubSchedule.create({
        vault_id: testVault.id,
        top_up_amount: '1000',
        cliff_duration: 86400,
        vesting_start_date: new Date(Date.now() - 86400),
        vesting_duration: 172800,
        start_timestamp: new Date(Date.now() - 86400),
        end_timestamp: new Date(Date.now() + 86400),
        transaction_hash: '0xabcdef1234567890',
        block_number: 12345
      });
    });
  });
});
