const tvlPriceCorrelationService = require('../services/tvlPriceCorrelationService');
const { HistoricalTVL, HistoricalTokenPrice } = require('../models');

describe('TVL-Price Correlation Service', () => {
  beforeEach(() => {
    // Clear cache before each test
    tvlPriceCorrelationService.clearCache();
  });

  describe('Correlation Calculations', () => {
    test('should calculate Pearson correlation correctly', () => {
      const tvlData = [100, 110, 120, 130, 140];
      const priceData = [10, 11, 12, 13, 14];
      
      const correlation = tvlPriceCorrelationService.calculatePearsonCorrelation(tvlData, priceData);
      
      // Perfect positive correlation should be 1
      expect(correlation).toBeCloseTo(1, 5);
    });

    test('should calculate negative Pearson correlation correctly', () => {
      const tvlData = [100, 110, 120, 130, 140];
      const priceData = [14, 13, 12, 11, 10];
      
      const correlation = tvlPriceCorrelationService.calculatePearsonCorrelation(tvlData, priceData);
      
      // Perfect negative correlation should be -1
      expect(correlation).toBeCloseTo(-1, 5);
    });

    test('should calculate Spearman correlation correctly', () => {
      const tvlData = [100, 110, 120, 130, 140];
      const priceData = [10, 11, 12, 13, 14];
      
      const correlation = tvlPriceCorrelationService.calculateSpearmanCorrelation(tvlData, priceData);
      
      // Perfect positive correlation should be 1
      expect(correlation).toBeCloseTo(1, 5);
    });

    test('should handle empty arrays', () => {
      const correlation1 = tvlPriceCorrelationService.calculatePearsonCorrelation([], []);
      const correlation2 = tvlPriceCorrelationService.calculateSpearmanCorrelation([], []);
      
      expect(correlation1).toBe(0);
      expect(correlation2).toBe(0);
    });

    test('should handle arrays of different lengths', () => {
      const correlation1 = tvlPriceCorrelationService.calculatePearsonCorrelation([1, 2, 3], [1, 2]);
      const correlation2 = tvlPriceCorrelationService.calculateSpearmanCorrelation([1, 2, 3], [1, 2]);
      
      expect(correlation1).toBe(0);
      expect(correlation2).toBe(0);
    });
  });

  describe('Volatility Calculations', () => {
    test('should calculate volatility correctly', () => {
      const priceData = [100, 105, 95, 110, 90];
      
      const volatility = tvlPriceCorrelationService.calculateVolatility(priceData);
      
      expect(volatility).toBeGreaterThan(0);
      expect(volatility).toBeLessThan(1);
    });

    test('should return 0 for single data point', () => {
      const volatility = tvlPriceCorrelationService.calculateVolatility([100]);
      
      expect(volatility).toBe(0);
    });

    test('should return 0 for empty array', () => {
      const volatility = tvlPriceCorrelationService.calculateVolatility([]);
      
      expect(volatility).toBe(0);
    });
  });

  describe('Data Alignment', () => {
    test('should align TVL and price data by date', () => {
      const tvlData = [
        { snapshot_date: '2023-01-01', total_value_locked: '1000' },
        { snapshot_date: '2023-01-02', total_value_locked: '1100' },
        { snapshot_date: '2023-01-03', total_value_locked: '1200' }
      ];

      const priceData = [
        { price_date: '2023-01-01', price_usd: '10' },
        { price_date: '2023-01-02', price_usd: '11' },
        { price_date: '2023-01-03', price_usd: '12' }
      ];

      const aligned = tvlPriceCorrelationService.alignDataByDate(tvlData, priceData);

      expect(aligned.dates).toHaveLength(2); // 2 changes from 3 data points
      expect(aligned.tvls).toHaveLength(2);
      expect(aligned.prices).toHaveLength(2);
      expect(aligned.tvlChanges).toHaveLength(2);
      expect(aligned.priceChanges).toHaveLength(2);
    });

    test('should handle missing dates', () => {
      const tvlData = [
        { snapshot_date: '2023-01-01', total_value_locked: '1000' },
        { snapshot_date: '2023-01-03', total_value_locked: '1200' }
      ];

      const priceData = [
        { price_date: '2023-01-01', price_usd: '10' },
        { price_date: '2023-01-02', price_usd: '11' },
        { price_date: '2023-01-03', price_usd: '12' }
      ];

      const aligned = tvlPriceCorrelationService.alignDataByDate(tvlData, priceData);

      // Should only include common dates
      expect(aligned.dates).toEqual(['2023-01-03']);
    });
  });

  describe('Correlation Interpretation', () => {
    test('should interpret correlation correctly', () => {
      expect(tvlPriceCorrelationService.interpretCorrelation(0.9)).toBe('Very Strong');
      expect(tvlPriceCorrelationService.interpretCorrelation(0.7)).toBe('Strong');
      expect(tvlPriceCorrelationService.interpretCorrelation(0.5)).toBe('Moderate');
      expect(tvlPriceCorrelationService.interpretCorrelation(0.3)).toBe('Weak');
      expect(tvlPriceCorrelationService.interpretCorrelation(0.1)).toBe('Very Weak');
      expect(tvlPriceCorrelationService.interpretCorrelation(-0.9)).toBe('Very Strong');
    });
  });

  describe('Marketing Insights Generation', () => {
    test('should generate insights for negative correlation', () => {
      const insights = tvlPriceCorrelationService.generateInsights(-0.5, -0.4, 0.03, 0.15);

      expect(insights).toBeInstanceOf(Array);
      expect(insights.length).toBeGreaterThan(0);
      
      const priceStabilityInsight = insights.find(i => i.type === 'price_stability');
      expect(priceStabilityInsight).toBeDefined();
      expect(priceStabilityInsight.marketingAngle).toBe('Strategic Price Stability Choice');
    });

    test('should generate insights for strong correlation', () => {
      const insights = tvlPriceCorrelationService.generateInsights(0.8, 0.7, 0.05, 0.1);

      expect(insights).toBeInstanceOf(Array);
      
      const strongRelationshipInsight = insights.find(i => i.type === 'strong_relationship');
      expect(strongRelationshipInsight).toBeDefined();
      expect(strongRelationshipInsight.marketingAngle).toBe('Market Influence Through Vesting');
    });

    test('should always include quantitative evidence insight', () => {
      const insights = tvlPriceCorrelationService.generateInsights(0.1, 0.1, 0.05, 0.05);

      const quantitativeInsight = insights.find(i => i.type === 'quantitative_evidence');
      expect(quantitativeInsight).toBeDefined();
      expect(quantitativeInsight.marketingAngle).toBe('Data-Driven Vault Benefits');
    });
  });
});

describe('Correlation API Endpoints', () => {
  let app;
  
  beforeAll(async () => {
    // Setup test app
    app = require('../index');
  });

  describe('GET /api/correlation/analysis', () => {
    test('should return correlation analysis', async () => {
      const response = await request(app)
        .get('/api/correlation/analysis')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('correlations');
      expect(response.body.data).toHaveProperty('insights');
      expect(response.body.data).toHaveProperty('period');
    });

    test('should handle custom date range', async () => {
      const startDate = '2023-01-01';
      const endDate = '2023-01-31';

      const response = await request(app)
        .get(`/api/correlation/analysis?startDate=${startDate}&endDate=${endDate}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.period.startDate).toBe(startDate);
      expect(response.body.data.period.endDate).toBe(endDate);
    });

    test('should handle invalid date format', async () => {
      const response = await request(app)
        .get('/api/correlation/analysis?startDate=invalid-date')
        .expect(400);

      expect(response.body.error).toBe('Invalid date format. Use YYYY-MM-DD format.');
    });

    test('should handle start date after end date', async () => {
      const response = await request(app)
        .get('/api/correlation/analysis?startDate=2023-01-31&endDate=2023-01-01')
        .expect(400);

      expect(response.body.error).toBe('Start date must be before end date.');
    });
  });

  describe('GET /api/correlation/chart', () => {
    test('should return chart data', async () => {
      const response = await request(app)
        .get('/api/correlation/chart')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('chartData');
      expect(response.body.data.chartData).toHaveProperty('dates');
      expect(response.body.data.chartData).toHaveProperty('tvlChanges');
      expect(response.body.data.chartData).toHaveProperty('priceChanges');
    });
  });

  describe('GET /api/correlation/insights', () => {
    test('should return marketing insights', async () => {
      const response = await request(app)
        .get('/api/correlation/insights')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('marketingSummary');
      expect(response.body.data.marketingSummary).toHaveProperty('primaryAngle');
      expect(response.body.data.marketingSummary).toHaveProperty('keyFinding');
    });
  });

  describe('GET /api/correlation/historical-tvl', () => {
    test('should return historical TVL data', async () => {
      const response = await request(app)
        .get('/api/correlation/historical-tvl')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('tvlData');
      expect(response.body.data).toHaveProperty('summary');
    });
  });

  describe('POST /api/correlation/create-snapshot', () => {
    test('should create TVL snapshot (admin only)', async () => {
      // This test would require admin authentication
      // For now, just test that the endpoint exists
      const response = await request(app)
        .post('/api/correlation/create-snapshot')
        .expect(401); // Should require authentication

      expect(response.body.error).toBeDefined();
    });
  });

  describe('DELETE /api/correlation/cache', () => {
    test('should clear cache (admin only)', async () => {
      // This test would require admin authentication
      const response = await request(app)
        .delete('/api/correlation/cache')
        .expect(401); // Should require authentication

      expect(response.body.error).toBeDefined();
    });
  });
});

describe('Integration Tests', () => {
  test('should perform full correlation analysis workflow', async () => {
    // This test would require database setup with mock data
    // For now, just test the service methods integration
    
    const mockOptions = {
      tokenAddress: null,
      startDate: new Date('2023-01-01'),
      endDate: new Date('2023-01-31'),
      correlationType: 'pearson'
    };

    // Mock the database calls
    jest.spyOn(HistoricalTVL, 'findAll').mockResolvedValue([
      { snapshot_date: '2023-01-01', total_value_locked: '1000' },
      { snapshot_date: '2023-01-02', total_value_locked: '1100' },
      { snapshot_date: '2023-01-03', total_value_locked: '1200' }
    ]);

    jest.spyOn(HistoricalTokenPrice, 'findAll').mockResolvedValue([
      { price_date: '2023-01-01', price_usd: '10' },
      { price_date: '2023-01-02', price_usd: '11' },
      { price_date: '2023-01-03', price_usd: '12' }
    ]);

    // This would normally throw an error due to insufficient data
    // but demonstrates the integration flow
    try {
      await tvlPriceCorrelationService.getCorrelationAnalysis(mockOptions);
    } catch (error) {
      expect(error.message).toContain('Insufficient data');
    }

    // Restore mocks
    HistoricalTVL.findAll.mockRestore();
    HistoricalTokenPrice.findAll.mockRestore();
  });
});
