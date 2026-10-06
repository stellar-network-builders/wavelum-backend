const request = require('supertest');
const app = require('../src/index');
const { sequelize } = require('../src/database/connection');
const { 
  Vault, 
  SubSchedule, 
  Beneficiary, 
  VestingMilestone, 
  HistoricalTokenPrice, 
  CostBasisReport 
} = require('../src/models');

describe('Historical Price Tracking System', () => {
  let testVault;
  let testBeneficiary;
  let testSubSchedule;

  beforeAll(async () => {
    // Ensure database is synced
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    // Clean up database
    await VestingMilestone.destroy({ where: {} });
    await HistoricalTokenPrice.destroy({ where: {} });
    await CostBasisReport.destroy({ where: {} });
    await SubSchedule.destroy({ where: {} });
    await Beneficiary.destroy({ where: {} });
    await Vault.destroy({ where: {} });

    // Create test data
    testVault = await Vault.create({
      address: '0xtest-vault-address',
      name: 'Test Vault',
      owner_address: '0xtest-owner',
      token_address: '0xtest-token',
      total_amount: '1000.0',
      token_type: 'static'
    });

    testBeneficiary = await Beneficiary.create({
      vault_id: testVault.id,
      address: '0xtest-beneficiary',
      total_allocated: '500.0',
      total_withdrawn: '0.0'
    });

    const vestingStart = new Date('2024-01-01');
    const vestingEnd = new Date('2024-12-31');
    const cliffDate = new Date('2024-03-01');

    testSubSchedule = await SubSchedule.create({
      vault_id: testVault.id,
      top_up_amount: '500.0',
      cliff_duration: 5184000, // 60 days in seconds
      cliff_date: cliffDate,
      vesting_start_date: vestingStart,
      vesting_duration: 31536000, // 365 days in seconds
      start_timestamp: vestingStart,
      end_timestamp: vestingEnd,
      transaction_hash: '0xtest-tx-hash',
      amount_withdrawn: '0.0',
      amount_released: '0.0',
      is_active: true
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Health Check', () => {
    test('should return healthy status', async () => {
      const response = await request(app)
        .get('/api/historical-prices/health')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.status).toBe('healthy');
      expect(response.body.data).toHaveProperty('milestones_count');
      expect(response.body.data).toHaveProperty('cached_prices_count');
      expect(response.body.data).toHaveProperty('reports_count');
    });
  });

  describe('Milestone Generation', () => {
    test('should generate vesting milestones for a vault', async () => {
      const response = await request(app)
        .post('/api/historical-prices/generate-milestones')
        .send({
          vaultId: testVault.id,
          incrementDays: 30,
          forceRefresh: false
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.milestones_count).toBeGreaterThan(0);
      expect(response.body.data.milestones).toBeInstanceOf(Array);

      // Verify milestones were created in database
      const milestones = await VestingMilestone.findAll({
        where: { vault_id: testVault.id }
      });
      expect(milestones.length).toBeGreaterThan(0);
    });

    test('should handle invalid vault ID', async () => {
      const response = await request(app)
        .post('/api/historical-prices/generate-milestones')
        .send({
          vaultId: '00000000-0000-0000-0000-000000000000'
        })
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });

    test('should require vaultId parameter', async () => {
      const response = await request(app)
        .post('/api/historical-prices/generate-milestones')
        .send({})
        .expect(400);

      expect(response.body.error).toContain('vaultId is required');
    });
  });

  describe('Historical Prices', () => {
    test('should fetch historical prices for a token', async () => {
      // First create some test price data
      await HistoricalTokenPrice.create({
        token_address: '0xtest-token',
        price_date: '2024-01-15',
        price_usd: '1.50',
        vwap_24h_usd: '1.48',
        volume_24h_usd: '100000.0',
        price_source: 'test_source',
        data_quality: 'good'
      });

      const response = await request(app)
        .get('/api/historical-prices/prices/0xtest-token')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.token_address).toBe('0xtest-token');
      expect(response.body.data.prices).toBeInstanceOf(Array);
      expect(response.body.data.prices.length).toBe(1);
      expect(response.body.data.prices[0]).toHaveProperty('price_usd');
      expect(response.body.data.prices[0]).toHaveProperty('vwap_24h_usd');
    });

    test('should filter prices by date range', async () => {
      // Create multiple price entries
      await HistoricalTokenPrice.bulkCreate([
        {
          token_address: '0xtest-token',
          price_date: '2024-01-01',
          price_usd: '1.00',
          vwap_24h_usd: '0.98',
          price_source: 'test_source'
        },
        {
          token_address: '0xtest-token',
          price_date: '2024-01-15',
          price_usd: '1.50',
          vwap_24h_usd: '1.48',
          price_source: 'test_source'
        },
        {
          token_address: '0xtest-token',
          price_date: '2024-02-01',
          price_usd: '2.00',
          vwap_24h_usd: '1.98',
          price_source: 'test_source'
        }
      ]);

      const response = await request(app)
        .get('/api/historical-prices/prices/0xtest-token')
        .query({
          startDate: '2024-01-10',
          endDate: '2024-01-20'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.prices.length).toBe(1);
      expect(response.body.data.prices[0].date).toBe('2024-01-15');
    });
  });

  describe('Vesting Milestones', () => {
    beforeEach(async () => {
      // Create test milestones
      await VestingMilestone.create({
        vault_id: testVault.id,
        sub_schedule_id: testSubSchedule.id,
        beneficiary_id: testBeneficiary.id,
        milestone_date: new Date('2024-03-01'),
        milestone_type: 'cliff_end',
        vested_amount: '100.0',
        cumulative_vested: '100.0',
        token_address: '0xtest-token',
        price_usd: '1.50',
        vwap_24h_usd: '1.48',
        price_source: 'test_source'
      });
    });

    test('should fetch milestones for a beneficiary', async () => {
      const response = await request(app)
        .get('/api/historical-prices/milestones/0xtest-beneficiary')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.milestones).toBeInstanceOf(Array);
      expect(response.body.data.milestones.length).toBe(1);
      expect(response.body.data.milestones[0]).toHaveProperty('milestone_type');
      expect(response.body.data.milestones[0]).toHaveProperty('vested_amount');
      expect(response.body.data.milestones[0]).toHaveProperty('price_usd');
    });

    test('should filter milestones by token address', async () => {
      const response = await request(app)
        .get('/api/historical-prices/milestones/0xtest-beneficiary')
        .query({ tokenAddress: '0xtest-token' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.milestones.length).toBe(1);
    });

    test('should support pagination', async () => {
      const response = await request(app)
        .get('/api/historical-prices/milestones/0xtest-beneficiary')
        .query({ limit: 10, offset: 0 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('pagination');
      expect(response.body.data.pagination).toHaveProperty('total');
      expect(response.body.data.pagination).toHaveProperty('limit');
      expect(response.body.data.pagination).toHaveProperty('offset');
    });
  });

  describe('Cost Basis Reports', () => {
    beforeEach(async () => {
      // Create test milestones for 2024
      await VestingMilestone.bulkCreate([
        {
          vault_id: testVault.id,
          sub_schedule_id: testSubSchedule.id,
          beneficiary_id: testBeneficiary.id,
          milestone_date: new Date('2024-03-01'),
          milestone_type: 'cliff_end',
          vested_amount: '100.0',
          cumulative_vested: '100.0',
          token_address: '0xtest-token',
          price_usd: '1.50',
          vwap_24h_usd: '1.48',
          price_source: 'test_source'
        },
        {
          vault_id: testVault.id,
          sub_schedule_id: testSubSchedule.id,
          beneficiary_id: testBeneficiary.id,
          milestone_date: new Date('2024-06-01'),
          milestone_type: 'vesting_increment',
          vested_amount: '150.0',
          cumulative_vested: '250.0',
          token_address: '0xtest-token',
          price_usd: '2.00',
          vwap_24h_usd: '1.98',
          price_source: 'test_source'
        }
      ]);
    });

    test('should generate cost basis report for a beneficiary', async () => {
      const response = await request(app)
        .get('/api/historical-prices/cost-basis/0xtest-beneficiary/0xtest-token/2024')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('user_address');
      expect(response.body.data).toHaveProperty('token_address');
      expect(response.body.data).toHaveProperty('report_year');
      expect(response.body.data).toHaveProperty('total_vested_amount');
      expect(response.body.data).toHaveProperty('total_cost_basis_usd');
      expect(response.body.data).toHaveProperty('milestones');
      expect(response.body.data.milestones).toBeInstanceOf(Array);
      expect(response.body.data.milestones.length).toBe(2);

      // Verify calculations
      expect(parseFloat(response.body.data.total_vested_amount)).toBe(250.0);
      expect(parseFloat(response.body.data.total_cost_basis_usd)).toBeCloseTo(448.0, 1); // 100*1.48 + 150*1.98
    });

    test('should handle invalid year', async () => {
      const response = await request(app)
        .get('/api/historical-prices/cost-basis/0xtest-beneficiary/0xtest-token/invalid')
        .expect(400);

      expect(response.body.error).toContain('Invalid year');
    });

    test('should handle no milestones found', async () => {
      const response = await request(app)
        .get('/api/historical-prices/cost-basis/0xtest-beneficiary/0xtest-token/2023')
        .expect(500);

      expect(response.body.error).toContain('No vesting milestones found');
    });
  });

  describe('Cost Basis Report Management', () => {
    beforeEach(async () => {
      // Create a test report
      await CostBasisReport.create({
        user_address: '0xtest-beneficiary',
        token_address: '0xtest-token',
        report_year: 2024,
        total_vested_amount: '250.0',
        total_cost_basis_usd: '448.0',
        total_milestones: 2,
        report_data: {
          milestones: [],
          summary: { average_price_usd: 1.792 }
        }
      });
    });

    test('should fetch cost basis reports for a user', async () => {
      const response = await request(app)
        .get('/api/historical-prices/reports/0xtest-beneficiary')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.user_address).toBe('0xtest-beneficiary');
      expect(response.body.data.reports).toBeInstanceOf(Array);
      expect(response.body.data.reports.length).toBe(1);
      expect(response.body.data.reports[0]).toHaveProperty('report_year');
      expect(response.body.data.reports[0]).toHaveProperty('total_cost_basis_usd');
    });

    test('should fetch detailed cost basis report', async () => {
      const response = await request(app)
        .get('/api/historical-prices/reports/0xtest-beneficiary/0xtest-token/2024/details')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('milestones');
      expect(response.body.data).toHaveProperty('summary');
    });

    test('should handle report not found', async () => {
      const response = await request(app)
        .get('/api/historical-prices/reports/0xtest-beneficiary/0xtest-token/2023/details')
        .expect(404);

      expect(response.body.error).toContain('not found');
    });
  });

  describe('Price Backfilling', () => {
    test('should backfill missing prices', async () => {
      // Create milestones without prices
      await VestingMilestone.create({
        vault_id: testVault.id,
        sub_schedule_id: testSubSchedule.id,
        beneficiary_id: testBeneficiary.id,
        milestone_date: new Date('2024-03-01'),
        milestone_type: 'cliff_end',
        vested_amount: '100.0',
        cumulative_vested: '100.0',
        token_address: '0xtest-token',
        price_usd: null,
        vwap_24h_usd: null,
        price_source: null
      });

      const response = await request(app)
        .post('/api/historical-prices/backfill')
        .send({
          tokenAddress: '0xtest-token',
          batchSize: 10
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('updated_count');
    });
  });

  describe('Job Management', () => {
    test('should get job statistics', async () => {
      const response = await request(app)
        .get('/api/admin/jobs/historical-prices/stats')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalRuns');
      expect(response.body.data).toHaveProperty('successfulRuns');
      expect(response.body.data).toHaveProperty('isRunning');
    });

    test('should start the job', async () => {
      const response = await request(app)
        .post('/api/admin/jobs/historical-prices/start')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('started');
    });

    test('should stop the job', async () => {
      const response = await request(app)
        .post('/api/admin/jobs/historical-prices/stop')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('stopped');
    });
  });

  describe('Error Handling', () => {
    test('should handle database connection errors gracefully', async () => {
      // This test would require mocking database failures
      // For now, we'll test basic error response format
      const response = await request(app)
        .get('/api/historical-prices/milestones/invalid-address')
        .expect(200);

      expect(response.body).toHaveProperty('success');
      expect(response.body).toHaveProperty('data');
    });

    test('should validate required parameters', async () => {
      const response = await request(app)
        .post('/api/historical-prices/generate-milestones')
        .send({})
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body).toHaveProperty('error');
    });
  });
});

// Helper function to run tests
if (require.main === module) {
  console.log('Running Historical Price Tracking tests...');
  console.log('Make sure the database is running and accessible.');
  console.log('Run with: npm test -- --testPathPattern=historicalPriceTracking.test.js');
}