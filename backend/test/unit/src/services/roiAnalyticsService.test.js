const roiAnalyticsService = require('./roiAnalyticsService');
const { sequelize } = require('../database/connection');
const { Vault, Beneficiary, GrantStream, GrantPriceSnapshot, RoiCalculation } = require('../models');

// Mock the price services
jest.mock('./priceService');
jest.mock('./stellarDexPriceService');

const priceService = require('./priceService');
const stellarDexPriceService = require('./stellarDexPriceService');

describe('RoiAnalyticsService', () => {
  beforeAll(async () => {
    // Setup test database
    await sequelize.sync({ force: false });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    roiAnalyticsService.clearCache();
  });

  describe('getUserRoiAnalytics', () => {
    const testUserAddress = 'GD5DJQD5YBHHV6M7JZ5Q4Q2Q3Q2Q3Q2Q3Q2Q3Q2Q3Q2Q3Q2Q3Q2Q';

    beforeEach(() => {
      // Mock price service responses
      priceService.getTokenPrice.mockResolvedValue('100.50');
      stellarDexPriceService.getTokenVWAP.mockResolvedValue({
        price_usd: '101.25',
        vwap_24h_usd: '101.25',
        volume_24h_usd: '50000',
        data_quality: 'good'
      });
    });

    test('should calculate ROI analytics for user with vaults', async () => {
      // Mock user vaults
      const mockVaults = [
        {
          id: 'vault-1',
          address: 'VAULT_ADDRESS_1',
          name: 'Test Vault 1',
          token_address: 'TOKEN_ADDRESS_1',
          total_amount: '1000',
          created_at: new Date('2023-01-01'),
          beneficiaries: []
        }
      ];

      jest.spyOn(roiAnalyticsService, 'getUserVaults').mockResolvedValue(mockVaults);
      jest.spyOn(roiAnalyticsService, 'getUserGrantStreams').mockResolvedValue([]);
      jest.spyOn(roiAnalyticsService, 'calculateVaultsRoi').mockResolvedValue([
        {
          vault_address: 'VAULT_ADDRESS_1',
          investment_value_usd: 100500,
          total_value_usd: 101250,
          unrealized_gains_usd: 750,
          roi_percentage: 0.75
        }
      ]);

      const result = await roiAnalyticsService.getUserRoiAnalytics(testUserAddress);

      expect(result).toBeDefined();
      expect(result.user_address).toBe(testUserAddress);
      expect(result.vaults).toHaveLength(1);
      expect(result.grant_streams).toHaveLength(0);
      expect(result.overall_metrics).toBeDefined();
      expect(result.summary).toBeDefined();
    });

    test('should handle user with no investments', async () => {
      jest.spyOn(roiAnalyticsService, 'getUserVaults').mockResolvedValue([]);
      jest.spyOn(roiAnalyticsService, 'getUserGrantStreams').mockResolvedValue([]);

      const result = await roiAnalyticsService.getUserRoiAnalytics(testUserAddress);

      expect(result.vaults).toHaveLength(0);
      expect(result.grant_streams).toHaveLength(0);
      expect(result.overall_metrics.total_investment_usd).toBe(0);
      expect(result.overall_metrics.overall_roi_percentage).toBe(0);
    });

    test('should use cache for repeated requests', async () => {
      jest.spyOn(roiAnalyticsService, 'getUserVaults').mockResolvedValue([]);
      jest.spyOn(roiAnalyticsService, 'getUserGrantStreams').mockResolvedValue([]);

      // First call
      await roiAnalyticsService.getUserRoiAnalytics(testUserAddress);
      
      // Second call should use cache
      const result = await roiAnalyticsService.getUserRoiAnalytics(testUserAddress);

      expect(result).toBeDefined();
      expect(roiAnalyticsService.getUserVaults).toHaveBeenCalledTimes(1);
      expect(roiAnalyticsService.getUserGrantStreams).toHaveBeenCalledTimes(1);
    });
  });

  describe('getVaultRoiAnalytics', () => {
    test('should calculate ROI for a specific vault', async () => {
      const mockVault = {
        id: 'vault-1',
        address: 'VAULT_ADDRESS_1',
        name: 'Test Vault 1',
        token_address: 'TOKEN_ADDRESS_1',
        total_amount: '1000',
        created_at: new Date('2023-01-01'),
        beneficiaries: [
          {
            total_withdrawn: '100'
          }
        ]
      };

      jest.spyOn(Vault, 'findOne').mockResolvedValue(mockVault);
      jest.spyOn(roiAnalyticsService, 'getGrantPrice').mockResolvedValue('100.00');
      jest.spyOn(roiAnalyticsService, 'getCurrentMarketPrice').mockResolvedValue('110.00');
      jest.spyOn(roiAnalyticsService, 'getTotalWithdrawnForVault').mockResolvedValue(100);

      const result = await roiAnalyticsService.getVaultRoiAnalytics('VAULT_ADDRESS_1');

      expect(result.vault_address).toBe('VAULT_ADDRESS_1');
      expect(result.grant_price_usd).toBe('100.00');
      expect(result.current_price_usd).toBe('110.00');
      expect(result.roi_percentage).toBeGreaterThan(0);
    });

    test('should throw error for non-existent vault', async () => {
      jest.spyOn(Vault, 'findOne').mockResolvedValue(null);

      await expect(roiAnalyticsService.getVaultRoiAnalytics('NON_EXISTENT'))
        .rejects.toThrow('Vault not found');
    });
  });

  describe('getGrantStreamRoiAnalytics', () => {
    test('should calculate ROI for a specific grant stream', async () => {
      const mockGrantStream = {
        id: 1,
        address: 'GRANT_ADDRESS_1',
        name: 'Test Grant 1',
        token_address: 'TOKEN_ADDRESS_1',
        current_amount: '5000',
        start_date: new Date('2023-01-01')
      };

      jest.spyOn(GrantStream, 'findOne').mockResolvedValue(mockGrantStream);
      jest.spyOn(roiAnalyticsService, 'getGrantPrice').mockResolvedValue('50.00');
      jest.spyOn(roiAnalyticsService, 'getCurrentMarketPrice').mockResolvedValue('75.00');

      const result = await roiAnalyticsService.getGrantStreamRoiAnalytics('GRANT_ADDRESS_1');

      expect(result.grant_stream_address).toBe('GRANT_ADDRESS_1');
      expect(result.grant_price_usd).toBe('50.00');
      expect(result.current_price_usd).toBe('75.00');
      expect(result.roi_percentage).toBeGreaterThan(0);
    });

    test('should throw error for non-existent grant stream', async () => {
      jest.spyOn(GrantStream, 'findOne').mockResolvedValue(null);

      await expect(roiAnalyticsService.getGrantStreamRoiAnalytics('NON_EXISTENT'))
        .rejects.toThrow('Grant stream not found');
    });
  });

  describe('getGrantPrice', () => {
    test('should get price from historical database first', async () => {
      const tokenAddress = 'TOKEN_ADDRESS_1';
      const grantDate = new Date('2023-01-01');

      const mockHistoricalPrice = {
        price_usd: '100.00'
      };

      jest.spyOn(GrantPriceSnapshot, 'findOne').mockResolvedValue(mockHistoricalPrice);

      const result = await roiAnalyticsService.getGrantPrice(tokenAddress, grantDate);

      expect(result).toBe(100.00);
      expect(GrantPriceSnapshot.findOne).toHaveBeenCalledWith({
        where: {
          token_address: tokenAddress,
          price_date: '2023-01-01'
        },
        order: [['created_at', 'DESC']]
      });
    });

    test('should fallback to price service if not in database', async () => {
      const tokenAddress = 'TOKEN_ADDRESS_1';
      const grantDate = new Date('2023-01-01');

      jest.spyOn(GrantPriceSnapshot, 'findOne').mockResolvedValue(null);
      priceService.getTokenPrice.mockResolvedValue('105.50');

      const result = await roiAnalyticsService.getGrantPrice(tokenAddress, grantDate);

      expect(result).toBe(105.50);
      expect(priceService.getTokenPrice).toHaveBeenCalledWith(tokenAddress, grantDate.getTime());
    });

    test('should fallback to current price if all else fails', async () => {
      const tokenAddress = 'TOKEN_ADDRESS_1';
      const grantDate = new Date('2023-01-01');

      jest.spyOn(GrantPriceSnapshot, 'findOne').mockResolvedValue(null);
      priceService.getTokenPrice.mockRejectedValue(new Error('Service unavailable'));
      jest.spyOn(roiAnalyticsService, 'getCurrentMarketPrice').mockResolvedValue(110.00);

      const result = await roiAnalyticsService.getGrantPrice(tokenAddress, grantDate);

      expect(result).toBe(110.00);
    });
  });

  describe('getCurrentMarketPrice', () => {
    test('should get price from Stellar DEX first', async () => {
      const tokenAddress = 'TOKEN_ADDRESS_1';
      const mockDexData = {
        price_usd: '101.25',
        vwap_24h_usd: '101.25'
      };

      stellarDexPriceService.getTokenVWAP.mockResolvedValue(mockDexData);

      const result = await roiAnalyticsService.getCurrentMarketPrice(tokenAddress);

      expect(result).toBe(101.25);
      expect(stellarDexPriceService.getTokenVWAP).toHaveBeenCalledWith(tokenAddress);
    });

    test('should fallback to price service if DEX fails', async () => {
      const tokenAddress = 'TOKEN_ADDRESS_1';

      stellarDexPriceService.getTokenVWAP.mockRejectedValue(new Error('DEX unavailable'));
      priceService.getTokenPrice.mockResolvedValue('99.75');

      const result = await roiAnalyticsService.getCurrentMarketPrice(tokenAddress);

      expect(result).toBe(99.75);
      expect(priceService.getTokenPrice).toHaveBeenCalledWith(tokenAddress);
    });
  });

  describe('calculateRoiMetrics', () => {
    test('should calculate ROI metrics correctly', () => {
      const grantPrice = 100;
      const currentPrice = 150;
      const totalAllocated = 1000;
      const totalWithdrawn = 200;
      const currentBalance = 800;

      const result = roiAnalyticsService.calculateRoiMetrics(
        grantPrice, currentPrice, totalAllocated, totalWithdrawn, currentBalance
      );

      expect(result.priceChange).toBe(50);
      expect(result.priceChangePercentage).toBe(50);
      expect(result.investmentValue).toBe(100000);
      expect(result.currentValue).toBe(120000);
      expect(result.unrealizedGains).toBe(40000);
      expect(result.roiPercentage).toBe(40);
    });

    test('should handle zero grant price', () => {
      const result = roiAnalyticsService.calculateRoiMetrics(
        0, 100, 1000, 0, 1000
      );

      expect(result.priceChangePercentage).toBe(0);
      expect(result.roiPercentage).toBe(0);
    });

    test('should handle negative price change', () => {
      const result = roiAnalyticsService.calculateRoiMetrics(
        100, 80, 1000, 0, 1000
      );

      expect(result.priceChange).toBe(-20);
      expect(result.priceChangePercentage).toBe(-20);
      expect(result.unrealizedGains).toBe(-20000);
      expect(result.roiPercentage).toBe(-20);
    });
  });

  describe('calculateOverallMetrics', () => {
    test('should aggregate metrics correctly', () => {
      const vaultRoiData = [
        {
          investment_value_usd: 100000,
          total_value_usd: 120000,
          unrealized_gains_usd: 20000,
          realized_gains_usd: 0,
          price_change_percentage: 20
        }
      ];

      const grantRoiData = [
        {
          investment_value_usd: 50000,
          total_value_usd: 45000,
          unrealized_gains_usd: -5000,
          realized_gains_usd: 0,
          price_change_percentage: -10
        }
      ];

      const result = roiAnalyticsService.calculateOverallMetrics(vaultRoiData, grantRoiData);

      expect(result.total_investment_usd).toBe(150000);
      expect(result.total_current_value_usd).toBe(165000);
      expect(result.total_unrealized_gains_usd).toBe(15000);
      expect(result.overall_roi_percentage).toBe(10);
      expect(result.investment_count).toBe(2);
      expect(result.profitable_investments).toBe(1);
      expect(result.losing_investments).toBe(1);
    });

    test('should handle empty investments', () => {
      const result = roiAnalyticsService.calculateOverallMetrics([], []);

      expect(result.total_investment_usd).toBe(0);
      expect(result.overall_roi_percentage).toBe(0);
      expect(result.investment_count).toBe(0);
    });
  });

  describe('generateSummary', () => {
    test('should generate positive ROI summary', () => {
      const metrics = {
        overall_roi_percentage: 25.5,
        total_unrealized_gains_usd: 15000,
        total_realized_gains_usd: 5000
      };

      const result = roiAnalyticsService.generateSummary(metrics);

      expect(result).toBe('Your investments have gained 25.50% ($20000.00) overall.');
    });

    test('should generate negative ROI summary', () => {
      const metrics = {
        overall_roi_percentage: -15.3,
        total_unrealized_gains_usd: -8000,
        total_realized_gains_usd: 0
      };

      const result = roiAnalyticsService.generateSummary(metrics);

      expect(result).toBe('Your investments have lost 15.30% ($8000.00) overall.');
    });

    test('should generate break-even summary', () => {
      const metrics = {
        overall_roi_percentage: 0,
        total_unrealized_gains_usd: 0,
        total_realized_gains_usd: 0
      };

      const result = roiAnalyticsService.generateSummary(metrics);

      expect(result).toBe('Your investments are at break-even.');
    });
  });

  describe('getBatchUserRoiAnalytics', () => {
    test('should process batch requests correctly', async () => {
      const userAddresses = ['USER1', 'USER2'];
      
      jest.spyOn(roiAnalyticsService, 'getUserRoiAnalytics')
        .mockResolvedValueOnce({ user_address: 'USER1', overall_metrics: { overall_roi_percentage: 10 } })
        .mockResolvedValueOnce({ user_address: 'USER2', overall_metrics: { overall_roi_percentage: -5 } });

      const result = await roiAnalyticsService.getBatchUserRoiAnalytics(userAddresses);

      expect(result).toHaveLength(2);
      expect(result[0].user_address).toBe('USER1');
      expect(result[1].user_address).toBe('USER2');
    });

    test('should handle errors in batch processing', async () => {
      const userAddresses = ['USER1', 'USER2'];
      
      jest.spyOn(roiAnalyticsService, 'getUserRoiAnalytics')
        .mockResolvedValueOnce({ user_address: 'USER1', overall_metrics: { overall_roi_percentage: 10 } })
        .mockRejectedValueOnce(new Error('Service unavailable'));

      const result = await roiAnalyticsService.getBatchUserRoiAnalytics(userAddresses);

      expect(result).toHaveLength(2);
      expect(result[0].user_address).toBe('USER1');
      expect(result[1].error).toBe('Service unavailable');
    });
  });

  describe('getMarketOverview', () => {
    test('should get market overview for all tokens', async () => {
      jest.spyOn(Vault, 'findAll').mockResolvedValue([
        { token_address: 'TOKEN1' },
        { token_address: 'TOKEN2' }
      ]);
      jest.spyOn(GrantStream, 'findAll').mockResolvedValue([
        { token_address: 'TOKEN2' },
        { token_address: 'TOKEN3' }
      ]);
      jest.spyOn(roiAnalyticsService, 'getCurrentMarketPrice')
        .mockResolvedValueOnce(100.0)
        .mockResolvedValueOnce(200.0)
        .mockResolvedValueOnce(300.0);

      const result = await roiAnalyticsService.getMarketOverview();

      expect(result.total_tokens).toBe(3);
      expect(result.tokens).toHaveLength(3);
      expect(result.tokens[0].token_address).toBe('TOKEN1');
      expect(result.tokens[0].current_price_usd).toBe(100.0);
    });
  });

  describe('cache management', () => {
    test('should clear cache correctly', () => {
      // Add something to cache
      roiAnalyticsService.cache.set('test-key', { data: 'test', timestamp: Date.now() });
      expect(roiAnalyticsService.cache.size).toBe(1);

      roiAnalyticsService.clearCache();
      expect(roiAnalyticsService.cache.size).toBe(0);
    });
  });

  describe('error handling', () => {
    test('should handle service errors gracefully', async () => {
      const testUserAddress = 'GD5DJQD5YBHHV6M7JZ5Q4Q2Q3Q2Q3Q2Q3Q2Q3Q2Q3Q2Q3Q2Q3Q2Q';

      jest.spyOn(roiAnalyticsService, 'getUserVaults').mockRejectedValue(new Error('Database error'));

      await expect(roiAnalyticsService.getUserRoiAnalytics(testUserAddress))
        .rejects.toThrow('Database error');
    });
  });
});
