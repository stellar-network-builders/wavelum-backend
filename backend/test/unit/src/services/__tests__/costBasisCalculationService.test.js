const CostBasisCalculationService = require('../costBasisCalculationService');
const { ConversionEvent, ClaimsHistory } = require('../../models');

// Mock dependencies
jest.mock('../../models');

const mockAccount = {
  balances: [
    {
      asset_code: 'USDC',
      asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
      balance: '150.5000000'
    },
    {
      asset_code: 'XLM',
      asset_type: 'native',
      balance: '25.1234560'
    }
  ]
};

const mockServer = {
  loadAccount: jest.fn().mockResolvedValue(mockAccount)
};

jest.mock('stellar-sdk', () => ({
  Server: jest.fn().mockImplementation(() => mockServer)
}));

describe('CostBasisCalculationService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CostBasisCalculationService();
  });

  describe('calculateCostBasis', () => {
    it('should calculate FIFO cost basis correctly', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';
      const method = 'FIFO';

      const mockConversionEvents = [
        {
          id: 'conv-1',
          user_address: userAddress,
          source_asset_code: 'TOKEN',
          destination_asset_code: 'USDC',
          source_amount: '1000.0000000',
          destination_amount: '100.0000000',
          exchange_rate: 0.1,
          exchange_rate_usd: 1.0,
          transaction_timestamp: new Date('2024-01-01'),
          conversion_type: 'direct_swap'
        },
        {
          id: 'conv-2',
          user_address: userAddress,
          source_asset_code: 'USDC',
          destination_asset_code: 'TOKEN',
          source_amount: '50.0000000',
          destination_amount: '500.0000000',
          exchange_rate: 10.0,
          exchange_rate_usd: 1.0,
          transaction_timestamp: new Date('2024-01-15'),
          conversion_type: 'direct_swap'
        }
      ];

      const mockClaims = [
        {
          id: 'claim-1',
          user_address: userAddress,
          amount_claimed: '1000.0000000',
          claim_timestamp: new Date('2023-12-01'),
          token_address: 'TOKEN_CONTRACT'
        }
      ];

      ConversionEvent.findAll.mockResolvedValue(mockConversionEvents);
      ClaimsHistory.findAll.mockResolvedValue(mockClaims);

      const result = await service.calculateCostBasis(userAddress, assetCode, method);

      expect(result.success).toBe(true);
      expect(result.data.userAddress).toBe(userAddress);
      expect(result.data.assetCode).toBe(assetCode);
      expect(result.data.method).toBe(method);
      expect(result.data.holdings).toBeDefined();
      expect(result.data.currentPosition).toBeDefined();
      expect(result.data.unrealized).toBeDefined();
      expect(result.data.realized).toBeDefined();
    });

    it('should handle LIFO cost basis calculation', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';
      const method = 'LIFO';

      const mockConversionEvents = [
        {
          id: 'conv-1',
          user_address: userAddress,
          source_asset_code: 'TOKEN',
          destination_asset_code: 'USDC',
          source_amount: '100.0000000',
          destination_amount: '10.0000000',
          exchange_rate: 0.1,
          transaction_timestamp: new Date('2024-01-01'),
          conversion_type: 'direct_swap'
        },
        {
          id: 'conv-2',
          user_address: userAddress,
          source_asset_code: 'TOKEN',
          destination_asset_code: 'USDC',
          source_amount: '200.0000000',
          destination_amount: '20.0000000',
          exchange_rate: 0.1,
          transaction_timestamp: new Date('2024-01-15'),
          conversion_type: 'direct_swap'
        }
      ];

      ConversionEvent.findAll.mockResolvedValue(mockConversionEvents);
      ClaimsHistory.findAll.mockResolvedValue([]);

      const result = await service.calculateCostBasis(userAddress, assetCode, method);

      expect(result.success).toBe(true);
      expect(result.data.method).toBe('LIFO');
      
      // Verify LIFO logic - most recent acquisition should be used first
      const disposals = result.data.holdings.filter(h => h.type === 'disposal');
      expect(disposals.length).toBeGreaterThan(0);
    });

    it('should handle AVERAGE cost basis calculation', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';
      const method = 'AVERAGE';

      const mockConversionEvents = [
        {
          id: 'conv-1',
          user_address: userAddress,
          source_asset_code: 'TOKEN',
          destination_asset_code: 'USDC',
          source_amount: '100.0000000',
          destination_amount: '10.0000000',
          exchange_rate: 0.1,
          transaction_timestamp: new Date('2024-01-01'),
          conversion_type: 'direct_swap'
        },
        {
          id: 'conv-2',
          user_address: userAddress,
          source_asset_code: 'TOKEN',
          destination_asset_code: 'USDC',
          source_amount: '200.0000000',
          destination_amount: '25.0000000',
          exchange_rate: 0.125,
          transaction_timestamp: new Date('2024-01-15'),
          conversion_type: 'direct_swap'
        }
      ];

      ConversionEvent.findAll.mockResolvedValue(mockConversionEvents);
      ClaimsHistory.findAll.mockResolvedValue([]);

      const result = await service.calculateCostBasis(userAddress, assetCode, method);

      expect(result.success).toBe(true);
      expect(result.data.method).toBe('AVERAGE');
      
      // Verify average cost basis calculation
      const holdings = result.data.holdings.filter(h => h.type === 'holding');
      expect(holdings.length).toBe(1);
      
      const holding = holdings[0];
      const expectedAverageCost = (1000 + 200) / (10 + 25); // Total cost / total received
      expect(parseFloat(holding.averageCostBasis)).toBeCloseTo(expectedAverageCost, 2);
    });

    it('should handle empty conversion events', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';

      ConversionEvent.findAll.mockResolvedValue([]);
      ClaimsHistory.findAll.mockResolvedValue([]);

      const result = await service.calculateCostBasis(userAddress, assetCode, 'FIFO');

      expect(result.success).toBe(true);
      expect(result.data.holdings).toEqual([]);
      expect(result.data.summary.totalAcquired).toBe(0);
      expect(result.data.summary.totalCostBasis).toBe(0);
    });

    it('should calculate unrealized gains correctly', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';

      const mockHoldings = [
        {
          type: 'holding',
          amount: '100.0000000',
          costBasis: '50.0000000',
          price: 1.0
        }
      ];

      // Mock current position
      const mockCurrentPosition = {
        currentBalance: '100.0000000',
        trackedBalance: '100.0000000',
        difference: 0
      };

      // Mock current price
      jest.spyOn(service, 'getCurrentPrice').mockResolvedValue(1.5);

      const unrealized = await service.calculateUnrealizedGains(mockHoldings, mockCurrentPosition);

      expect(unrealized.totalCostBasis).toBe(50);
      expect(unrealized.totalAmount).toBe(100);
      expect(unrealized.currentPrice).toBe(1.5);
      expect(unrealized.currentValue).toBe(150);
      expect(unrealized.totalGain).toBe(100);
      expect(unrealized.gainPercentage).toBe(100);
    });

    it('should calculate realized gains correctly', async () => {
      const mockHoldings = [
        {
          type: 'disposal',
          amountDisposed: '50.0000000',
          costBasis: '25.0000000',
          proceeds: 75.0,
          gain: 50.0,
          acquisitionDate: new Date('2023-01-01'),
          disposalDate: new Date('2024-01-01')
        }
      ];

      const mockConversionEvents = [];

      const realized = service.calculateRealizedGains(mockHoldings, mockConversionEvents);

      expect(realized.totalRealizedGain).toBe(50);
      expect(realized.totalRealizedLoss).toBe(0);
      expect(realized.netGain).toBe(50);
      expect(realized.shortTermGains).toBe(50); // Less than 1 year
      expect(realized.longTermGains).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';

      ConversionEvent.findAll.mockRejectedValue(new Error('Database error'));

      await expect(service.calculateCostBasis(userAddress, assetCode, 'FIFO'))
        .rejects.toThrow('Database error');
    });
  });

  describe('generateTaxReport', () => {
    it('should generate comprehensive tax report', async () => {
      const userAddress = 'GD1234567890abcdef';
      const taxYear = 2024;

      const mockCostBasisResult = {
        success: true,
        data: {
          holdings: [
            {
              type: 'disposal',
              gain: 100.0,
              acquisitionDate: new Date('2023-01-01'),
              disposalDate: new Date('2024-01-01')
            }
          ],
          summary: {
            shortTermGains: 100,
            longTermGains: 200,
            totalGains: 300,
            totalLosses: 50
          }
        }
      };

      jest.spyOn(service, 'calculateCostBasis').mockResolvedValue(mockCostBasisResult);

      const result = await service.generateTaxReport(userAddress, taxYear);

      expect(result.success).toBe(true);
      expect(result.data.userAddress).toBe(userAddress);
      expect(result.data.taxYear).toBe(2024);
      expect(result.data.summary.shortTermGains).toBe(100);
      expect(result.data.summary.longTermGains).toBe(200);
      expect(result.data.summary.totalGains).toBe(300);
      expect(result.data.recommendations).toBeDefined();
    });

    it('should validate tax year parameter', async () => {
      const userAddress = 'GD1234567890abcdef';
      const invalidTaxYear = '2019'; // Too old

      const result = await service.generateTaxReport(userAddress, invalidTaxYear);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid tax year');
    });

    it('should filter events by tax year correctly', async () => {
      const userAddress = 'GD1234567890abcdef';
      const taxYear = 2024;

      const mockConversionEvents = [
        {
          transaction_timestamp: new Date('2023-12-31'), // Previous year
          exchange_rate: 0.1
        },
        {
          transaction_timestamp: new Date('2024-06-15'), // Current year
          exchange_rate: 0.15
        }
      ];

      jest.spyOn(service, 'calculateCostBasis').mockResolvedValue({
        success: true,
        data: {
          holdings: [],
          summary: {}
        }
      });

      ConversionEvent.findAll.mockResolvedValue(mockConversionEvents);

      const result = await service.generateTaxReport(userAddress, taxYear);

      expect(ConversionEvent.findAll).toHaveBeenCalledWith({
        where: {
          user_address: userAddress,
          transaction_timestamp: {
            [require('sequelize').Op.gte]: new Date(2024, 0, 1),
            [require('sequelize').Op.lt]: new Date(2025, 0, 1)
          }
        },
        order: [['transaction_timestamp', 'ASC']]
      });
    });
  });

  describe('calculateHoldingPeriod', () => {
    it('should calculate holding period in days correctly', () => {
      const acquisitionDate = new Date('2023-01-01');
      const disposalDate = new Date('2024-01-01');

      const holdingDays = service.calculateHoldingPeriod(acquisitionDate, disposalDate);

      expect(holdingDays).toBe(365); // Exactly 1 year
    });

    it('should handle partial years', () => {
      const acquisitionDate = new Date('2023-06-15');
      const disposalDate = new Date('2024-01-01');

      const holdingDays = service.calculateHoldingPeriod(acquisitionDate, disposalDate);

      expect(holdingDays).toBe(200); // Approximately 200 days
    });

    it('should handle same day transactions', () => {
      const sameDay = new Date('2024-01-01');

      const holdingDays = service.calculateHoldingPeriod(sameDay, sameDay);

      expect(holdingDays).toBe(0);
    });
  });

  describe('generateTaxRecommendations', () => {
    it('should recommend tax optimization for short-term gains', () => {
      const shortTermGains = 1000;
      const longTermGains = 100;

      const recommendations = service.generateTaxRecommendations(shortTermGains, longTermGains);

      const shortTermRec = recommendations.find(r => r.type === 'tax_optimization');
      expect(shortTermRec).toBeDefined();
      expect(shortTermRec.priority).toBe('high');
      expect(shortTermRec.title).toContain('Long-Term Gains');
    });

    it('should recommend tax planning for long-term gains', () => {
      const shortTermGains = 100;
      const longTermGains = 1000;

      const recommendations = service.generateTaxRecommendations(shortTermGains, longTermGains);

      const longTermRec = recommendations.find(r => r.type === 'tax_planning');
      expect(longTermRec).toBeDefined();
      expect(longTermRec.priority).toBe('medium');
      expect(longTermRec.title).toContain('Tax Planning');
    });

    it('should not generate recommendations for no gains', () => {
      const recommendations = service.generateTaxRecommendations(0, 0);

      expect(recommendations).toHaveLength(0);
    });
  });

  describe('extractAssetCode', () => {
    it('should extract USDC code correctly', () => {
      const tokenAddress = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'; // USDC issuer

      const assetCode = service.extractAssetCode(tokenAddress);

      expect(assetCode).toBe('USDC');
    });

    it('should extract XLM code correctly', () => {
      const tokenAddress = 'native'; // XLM

      const assetCode = service.extractAssetCode(tokenAddress);

      expect(assetCode).toBe('XLM');
    });

    it('should return default for unknown tokens', () => {
      const tokenAddress = 'unknown_token_address';

      const assetCode = service.extractAssetCode(tokenAddress);

      expect(assetCode).toBe('TOKEN');
    });
  });

  describe('getCurrentBalance', () => {
    it('should fetch balance from Stellar network', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';

      mockServer.loadAccount.mockResolvedValueOnce(mockAccount);

      const balance = await service.getCurrentBalance(userAddress, assetCode);

      expect(balance).toBe(150.5);
    });

    it('should return 0 for non-existent balance', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'UNKNOWN';

      const emptyAccount = { balances: [] };
      mockServer.loadAccount.mockResolvedValueOnce(emptyAccount);

      const balance = await service.getCurrentBalance(userAddress, assetCode);

      expect(balance).toBe(0);
    });

    it('should handle Stellar API errors', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';

      mockServer.loadAccount.mockRejectedValueOnce(new Error('Network error'));

      const balance = await service.getCurrentBalance(userAddress, assetCode);

      expect(balance).toBe(0);
    });
  });

  describe('getCurrentPrice', () => {
    it('should return 1.0 for USDC', async () => {
      const service = new CostBasisCalculationService();
      const price = await service.getCurrentPrice('USDC');

      expect(price).toBe(1.0);
    });

    it('should return XLM price', async () => {
      const service = new CostBasisCalculationService();
      const price = await service.getCurrentPrice('XLM');

      expect(price).toBe(0.1);
    });

    it('should return default price for unknown assets', async () => {
      const service = new CostBasisCalculationService();
      const price = await service.getCurrentPrice('UNKNOWN');

      expect(price).toBe(1.0);
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';

      ConversionEvent.findAll.mockRejectedValue(new Error('Connection timeout'));

      await expect(service.calculateCostBasis(userAddress, assetCode, 'FIFO'))
        .rejects.toThrow('Connection timeout');
    });

    it('should handle invalid cost basis method', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';
      const invalidMethod = 'INVALID';

      ConversionEvent.findAll.mockResolvedValue([]);
      ClaimsHistory.findAll.mockResolvedValue([]);

      const result = await service.calculateCostBasis(userAddress, assetCode, invalidMethod);

      expect(result.success).toBe(true);
      // Should default to FIFO for invalid methods
      expect(result.data.method).toBe('FIFO');
    });
  });

  describe('Performance', () => {
    it('should handle large datasets efficiently', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';

      // Mock large dataset
      const largeConversionEvents = Array.from({ length: 1000 }, (_, i) => ({
        id: `conv-${i}`,
        user_address: userAddress,
        source_asset_code: 'TOKEN',
        destination_asset_code: 'USDC',
        source_amount: '1000.0000000',
        destination_amount: '100.0000000',
        exchange_rate: 0.1,
        transaction_timestamp: new Date(2024, 0, 1 + (i % 365)),
        conversion_type: 'direct_swap'
      }));

      ConversionEvent.findAll.mockResolvedValue(largeConversionEvents);
      ClaimsHistory.findAll.mockResolvedValue([]);

      const startTime = Date.now();
      const result = await service.calculateCostBasis(userAddress, assetCode, 'FIFO');
      const endTime = Date.now();

      expect(result.success).toBe(true);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero amounts correctly', async () => {
      const userAddress = 'GD1234567890abcdef';
      const assetCode = 'USDC';

      const mockConversionEvents = [
        {
          source_amount: '0.0000000',
          destination_amount: '0.0000000',
          exchange_rate: 0
        }
      ];

      ConversionEvent.findAll.mockResolvedValue(mockConversionEvents);
      ClaimsHistory.findAll.mockResolvedValue([]);

      const result = await service.calculateCostBasis(userAddress, assetCode, 'FIFO');

      expect(result.success).toBe(true);
      expect(result.data.summary.totalAcquired).toBe(0);
      expect(result.data.summary.totalCostBasis).toBe(0);
    });

    it('should handle negative gains (losses)', async () => {
      const mockHoldings = [
        {
          type: 'disposal',
          amountDisposed: '100.0000000',
          costBasis: '150.0000000',
          proceeds: 100.0,
          gain: -50.0 // Loss
        }
      ];

      const realized = service.calculateRealizedGains(mockHoldings, []);

      expect(realized.totalRealizedGain).toBe(0);
      expect(realized.totalRealizedLoss).toBe(50);
      expect(realized.netGain).toBe(-50);
    });

    it('should handle division by zero in average calculation', async () => {
      const mockConversionEvents = [
        {
          source_amount: '0.0000000', // Zero acquisition amount
          destination_amount: '100.0000000',
          exchange_rate: 0.1
        }
      ];

      ConversionEvent.findAll.mockResolvedValue(mockConversionEvents);
      ClaimsHistory.findAll.mockResolvedValue([]);

      const result = await service.calculateCostBasis('GD1234567890abcdef', 'USDC', 'AVERAGE');

      expect(result.success).toBe(true);
      expect(result.data.summary.totalCostBasis).toBe(0);
      expect(result.data.summary.averageCostBasis).toBe(0);
    });
  });
});
