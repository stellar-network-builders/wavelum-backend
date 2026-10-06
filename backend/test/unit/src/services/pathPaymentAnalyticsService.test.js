const pathPaymentAnalyticsService = require('./pathPaymentAnalyticsService');
const { ConversionEvent, ClaimsHistory, CostBasisReport } = require('../models');
const { sequelize } = require('../database/connection');
const moment = require('moment');

describe('PathPaymentAnalyticsService', () => {
  let testUserAddress;
  let testConversionEvents;
  let testClaims;

  beforeAll(async () => {
    // Set up test database
    await sequelize.sync({ force: true });
    testUserAddress = 'GD5XQZOWZCQ5JQPYE4MIVUYR2QYQ22LUCPDBL4TCHJ72Y2N4QZTPQFM';
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await ConversionEvent.destroy({ where: {} });
    await ClaimsHistory.destroy({ where: {} });
    await CostBasisReport.destroy({ where: {} });
  });

  describe('getUserConversionEvents', () => {
    beforeEach(async () => {
      // Create test conversion events
      testConversionEvents = await ConversionEvent.bulkCreate([
        {
          transaction_hash: 'test_hash_1',
          user_address: testUserAddress,
          source_asset_code: 'TOKEN',
          source_asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3',
          source_amount: '1000.000000',
          destination_asset_code: 'USDC',
          destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          destination_amount: '500.000000',
          exchange_rate: '0.500000',
          exchange_rate_usd: '0.500000',
          block_number: 12345,
          transaction_timestamp: new Date('2024-01-15T10:00:00Z'),
          conversion_type: 'claim_and_swap',
          price_source: 'stellar_dex',
          data_quality: 'good'
        },
        {
          transaction_hash: 'test_hash_2',
          user_address: testUserAddress,
          source_asset_code: 'XLM',
          source_asset_issuer: null,
          source_amount: '2000.000000',
          destination_asset_code: 'USDC',
          destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          destination_amount: '1000.000000',
          exchange_rate: '0.500000',
          exchange_rate_usd: '0.500000',
          block_number: 12346,
          transaction_timestamp: new Date('2024-02-15T10:00:00Z'),
          conversion_type: 'direct_swap',
          price_source: 'stellar_dex',
          data_quality: 'excellent'
        }
      ]);
    });

    it('should return conversion events for a user within date range', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      
      const result = await pathPaymentAnalyticsService.getUserConversionEvents(
        testUserAddress,
        startDate,
        endDate
      );

      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by conversion type', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      
      const result = await pathPaymentAnalyticsService.getUserConversionEvents(
        testUserAddress,
        startDate,
        endDate,
        { conversionType: 'claim_and_swap' }
      );

      expect(result.events).toHaveLength(1);
      expect(result.events[0].conversion_type).toBe('claim_and_swap');
    });

    it('should filter by asset pair', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      
      const result = await pathPaymentAnalyticsService.getUserConversionEvents(
        testUserAddress,
        startDate,
        endDate,
        { assetPair: 'TOKEN/USDC' }
      );

      expect(result.events).toHaveLength(1);
      expect(result.events[0].source_asset_code).toBe('TOKEN');
    });

    it('should respect pagination limits', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-12-31');
      
      const result = await pathPaymentAnalyticsService.getUserConversionEvents(
        testUserAddress,
        startDate,
        endDate,
        { limit: 1, offset: 0 }
      );

      expect(result.events).toHaveLength(1);
      expect(result.total).toBe(2);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('generateCostBasisReport', () => {
    beforeEach(async () => {
      // Create test claims and conversion events
      testClaims = await ClaimsHistory.create({
        user_address: testUserAddress,
        token_address: 'TOKEN',
        amount_claimed: '1000.000000',
        claim_timestamp: new Date('2024-01-15T09:55:00Z'),
        transaction_hash: 'claim_hash_1',
        block_number: 12344,
        price_at_claim_usd: '0.450000'
      });

      testConversionEvents = await ConversionEvent.create({
        transaction_hash: 'test_hash_1',
        user_address: testUserAddress,
        claim_id: testClaims.id,
        source_asset_code: 'TOKEN',
        source_asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3',
        source_amount: '1000.000000',
        destination_asset_code: 'USDC',
        destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        destination_amount: '500.000000',
        exchange_rate: '0.500000',
        exchange_rate_usd: '0.500000',
        block_number: 12345,
        transaction_timestamp: new Date('2024-01-15T10:00:00Z'),
        conversion_type: 'claim_and_swap',
        price_source: 'stellar_dex',
        data_quality: 'good'
      });
    });

    it('should generate cost basis report for tax year', async () => {
      const report = await pathPaymentAnalyticsService.generateCostBasisReport(testUserAddress, 2024);

      expect(report).toBeDefined();
      expect(report.user_address).toBe(testUserAddress);
      expect(report.report_year).toBe(2024);
      expect(parseFloat(report.total_vested_amount)).toBe(1000);
      expect(parseFloat(report.total_cost_basis_usd)).toBe(500);
      expect(report.total_milestones).toBe(1);
      expect(report.report_data).toBeDefined();
      expect(report.report_data.detailedBreakdown).toHaveLength(1);
    });

    it('should update existing cost basis report', async () => {
      // Create initial report
      await pathPaymentAnalyticsService.generateCostBasisReport(testUserAddress, 2024);

      // Add another conversion event
      await ConversionEvent.create({
        transaction_hash: 'test_hash_2',
        user_address: testUserAddress,
        source_asset_code: 'TOKEN',
        source_asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3',
        source_amount: '500.000000',
        destination_asset_code: 'USDC',
        destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        destination_amount: '250.000000',
        exchange_rate: '0.500000',
        exchange_rate_usd: '0.500000',
        block_number: 12347,
        transaction_timestamp: new Date('2024-02-15T10:00:00Z'),
        conversion_type: 'direct_swap',
        price_source: 'stellar_dex',
        data_quality: 'good'
      });

      // Update report
      const updatedReport = await pathPaymentAnalyticsService.generateCostBasisReport(testUserAddress, 2024);

      expect(parseFloat(updatedReport.total_vested_amount)).toBe(1500);
      expect(parseFloat(updatedReport.total_cost_basis_usd)).toBe(750);
      expect(updatedReport.total_milestones).toBe(2);
    });
  });

  describe('getUserAnalyticsSummary', () => {
    beforeEach(async () => {
      // Create test conversion events for analytics
      await ConversionEvent.bulkCreate([
        {
          transaction_hash: 'test_hash_1',
          user_address: testUserAddress,
          source_asset_code: 'TOKEN',
          source_asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3',
          source_amount: '1000.000000',
          destination_asset_code: 'USDC',
          destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          destination_amount: '500.000000',
          exchange_rate: '0.500000',
          exchange_rate_usd: '0.500000',
          block_number: 12345,
          transaction_timestamp: new Date(),
          conversion_type: 'claim_and_swap',
          price_source: 'stellar_dex',
          data_quality: 'good'
        },
        {
          transaction_hash: 'test_hash_2',
          user_address: testUserAddress,
          source_asset_code: 'XLM',
          source_asset_issuer: null,
          source_amount: '2000.000000',
          destination_asset_code: 'USDC',
          destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          destination_amount: '1000.000000',
          exchange_rate: '0.500000',
          exchange_rate_usd: '0.500000',
          block_number: 12346,
          transaction_timestamp: new Date(),
          conversion_type: 'direct_swap',
          price_source: 'stellar_dex',
          data_quality: 'excellent'
        }
      ]);
    });

    it('should return analytics summary for user', async () => {
      const analytics = await pathPaymentAnalyticsService.getUserAnalyticsSummary(testUserAddress, '1Y');

      expect(analytics).toBeDefined();
      expect(analytics.summary).toBeDefined();
      expect(analytics.topAssetPairs).toBeDefined();
      expect(analytics.monthlyTrends).toBeDefined();
      expect(analytics.timeRange).toBe('1Y');
      expect(analytics.period).toBeDefined();
    });

    it('should handle different time ranges', async () => {
      const analytics24h = await pathPaymentAnalyticsService.getUserAnalyticsSummary(testUserAddress, '24H');
      const analytics7d = await pathPaymentAnalyticsService.getUserAnalyticsSummary(testUserAddress, '7D');

      expect(analytics24h.timeRange).toBe('24H');
      expect(analytics7d.timeRange).toBe('7D');
      
      // Periods should be different
      expect(analytics24h.period.start.getTime()).toBeGreaterThan(analytics7d.period.start.getTime());
    });
  });

  describe('getExchangeRateAnalytics', () => {
    beforeEach(async () => {
      // Create test conversion events for specific asset pair
      await ConversionEvent.bulkCreate([
        {
          transaction_hash: 'test_hash_1',
          user_address: testUserAddress,
          source_asset_code: 'TOKEN',
          source_asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3',
          source_amount: '1000.000000',
          destination_asset_code: 'USDC',
          destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          destination_amount: '500.000000',
          exchange_rate: '0.500000',
          exchange_rate_usd: '0.500000',
          block_number: 12345,
          transaction_timestamp: new Date(),
          conversion_type: 'direct_swap',
          price_source: 'stellar_dex',
          data_quality: 'good'
        },
        {
          transaction_hash: 'test_hash_2',
          user_address: testUserAddress,
          source_asset_code: 'TOKEN',
          source_asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3',
          source_amount: '1000.000000',
          destination_asset_code: 'USDC',
          destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          destination_amount: '550.000000',
          exchange_rate: '0.550000',
          exchange_rate_usd: '0.550000',
          block_number: 12346,
          transaction_timestamp: new Date(),
          conversion_type: 'direct_swap',
          price_source: 'stellar_dex',
          data_quality: 'good'
        }
      ]);
    });

    it('should return exchange rate analytics for asset pair', async () => {
      const analytics = await pathPaymentAnalyticsService.getExchangeRateAnalytics(
        { code: 'TOKEN', issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3' },
        { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
        '1M'
      );

      expect(analytics).toBeDefined();
      expect(analytics.assetPair).toBe('TOKEN/USDC');
      expect(analytics.timeRange).toBe('1M');
      expect(analytics.data).toHaveLength(2);
      expect(analytics.statistics).toBeDefined();
      expect(analytics.statistics.totalTransactions).toBe(2);
      expect(analytics.statistics.minRate).toBe(0.5);
      expect(analytics.statistics.maxRate).toBe(0.55);
    });

    it('should return empty result for asset pair with no data', async () => {
      const analytics = await pathPaymentAnalyticsService.getExchangeRateAnalytics(
        { code: 'NODATA', issuer: null },
        { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
        '1M'
      );

      expect(analytics).toBeDefined();
      expect(analytics.assetPair).toBe('NODATA/USDC');
      expect(analytics.data).toHaveLength(0);
      expect(analytics.statistics).toBeNull();
    });
  });

  describe('getSystemStats', () => {
    beforeEach(async () => {
      // Create test conversion events for system stats
      await ConversionEvent.bulkCreate([
        {
          transaction_hash: 'test_hash_1',
          user_address: testUserAddress,
          source_asset_code: 'TOKEN',
          source_asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3',
          source_amount: '1000.000000',
          destination_asset_code: 'USDC',
          destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          destination_amount: '500.000000',
          exchange_rate: '0.500000',
          exchange_rate_usd: '0.500000',
          block_number: 12345,
          transaction_timestamp: new Date(),
          conversion_type: 'direct_swap',
          price_source: 'stellar_dex',
          data_quality: 'good'
        },
        {
          transaction_hash: 'test_hash_2',
          user_address: 'GD2XQZOWZCQ5JQPYE4MIVUYR2QYQ22LUCPDBL4TCHJ72Y2N4QZTPQFM',
          source_asset_code: 'XLM',
          source_asset_issuer: null,
          source_amount: '2000.000000',
          destination_asset_code: 'USDC',
          destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
          destination_amount: '1000.000000',
          exchange_rate: '0.500000',
          exchange_rate_usd: '0.500000',
          block_number: 12346,
          transaction_timestamp: new Date(),
          conversion_type: 'direct_swap',
          price_source: 'stellar_dex',
          data_quality: 'excellent'
        }
      ]);
    });

    it('should return system-wide statistics', async () => {
      const stats = await pathPaymentAnalyticsService.getSystemStats('24H');

      expect(stats).toBeDefined();
      expect(stats.timeRange).toBe('24H');
      expect(stats.period).toBeDefined();
      expect(stats.overview).toBeDefined();
      expect(stats.topAssets).toBeDefined();
      expect(stats.overview.total_conversions).toBe('2');
      expect(stats.overview.unique_users).toBe('2');
    });
  });

  describe('helper functions', () => {
    it('should calculate median correctly', () => {
      const service = require('./pathPaymentAnalyticsService');
      
      // Odd number of values
      expect(service.calculateMedian([1, 3, 5])).toBe(3);
      
      // Even number of values
      expect(service.calculateMedian([1, 2, 3, 4])).toBe(2.5);
      
      // Single value
      expect(service.calculateMedian([7])).toBe(7);
    });

    it('should calculate volatility correctly', () => {
      const service = require('./pathPaymentAnalyticsService');
      
      // Constant values should have zero volatility
      expect(service.calculateVolatility([5, 5, 5, 5])).toBeCloseTo(0);
      
      // Should calculate standard deviation
      const volatility = service.calculateVolatility([1, 2, 3, 4, 5]);
      expect(volatility).toBeGreaterThan(0);
    });

    it('should calculate trend correctly', () => {
      const service = require('./pathPaymentAnalyticsService');
      
      // Increasing trend
      expect(service.calculateTrend([1, 2, 3, 4, 5])).toBeGreaterThan(0);
      
      // Decreasing trend
      expect(service.calculateTrend([5, 4, 3, 2, 1])).toBeLessThan(0);
      
      // Flat trend
      expect(service.calculateTrend([3, 3, 3, 3, 3])).toBeCloseTo(0);
    });

    it('should get start date from range correctly', () => {
      const service = require('./pathPaymentAnalyticsService');
      const now = new Date();
      
      const start1H = service.getStartDateFromRange('1H');
      expect(start1H.getTime()).toBeCloseTo(now.getTime() - 60 * 60 * 1000, -3);
      
      const start1D = service.getStartDateFromRange('24H');
      expect(start1D.getTime()).toBeCloseTo(now.getTime() - 24 * 60 * 60 * 1000, -3);
      
      const start1Y = service.getStartDateFromRange('1Y');
      expect(start1Y.getFullYear()).toBeLessThan(now.getFullYear());
    });
  });
});
