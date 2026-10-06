const axios = require('axios');

// Mock stellar-sdk before requiring anchorService
jest.mock('stellar-sdk', () => ({
  StellarTomlResolver: {
    resolve: jest.fn()
  }
}));

const anchorService = require('../anchorService');
const { StellarTomlResolver } = require('stellar-sdk');

jest.mock('axios');

describe('AnchorService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    anchorService.clearCache();
  });

  describe('getOffRampQuote', () => {
    it('should return a valid quote for USDC to USD', async () => {
      // Mock stellar.toml resolution
      StellarTomlResolver.resolve.mockResolvedValue({
        TRANSFER_SERVER_SEP0024: 'https://testanchor.stellar.org/sep24'
      });

      // Mock anchor info endpoint
      axios.get.mockResolvedValueOnce({
        data: {
          withdraw: {
            USDC: {
              enabled: true,
              fee_fixed: 2.5,
              min_amount: 10,
              max_amount: 10000
            }
          }
        }
      });

      // Mock price endpoint (no rate needed for USDC to USD)
      axios.get.mockResolvedValueOnce({
        data: { price: 1.0 }
      });

      const quote = await anchorService.getOffRampQuote('USDC', '100', 'USD');

      expect(quote).toBeDefined();
      expect(quote.assetCode).toBe('USDC');
      expect(quote.fiatCurrency).toBe('USD');
      expect(parseFloat(quote.inputAmount)).toBe(100);
      expect(parseFloat(quote.netPayout)).toBeLessThan(100); // Should be less due to fees
      expect(quote.fees).toBeDefined();
      expect(quote.fees.totalFees).toBeDefined();
    });

    it('should throw error for invalid token amount', async () => {
      await expect(
        anchorService.getOffRampQuote('USDC', 'invalid', 'USD')
      ).rejects.toThrow('Invalid token amount');
    });

    it('should throw error for unsupported fiat currency', async () => {
      await expect(
        anchorService.getOffRampQuote('USDC', '100', 'JPY')
      ).rejects.toThrow('Unsupported fiat currency');
    });

    it('should cache quotes and return cached result', async () => {
      StellarTomlResolver.resolve.mockResolvedValue({
        TRANSFER_SERVER_SEP0024: 'https://testanchor.stellar.org/sep24'
      });

      axios.get.mockResolvedValue({
        data: {
          withdraw: {
            USDC: {
              enabled: true,
              fee_fixed: 2.5
            }
          }
        }
      });

      axios.get.mockResolvedValueOnce({
        data: {
          withdraw: {
            USDC: {
              enabled: true,
              fee_fixed: 2.5
            }
          }
        }
      });

      axios.get.mockResolvedValueOnce({
        data: { price: 1.0 }
      });

      // First call
      const quote1 = await anchorService.getOffRampQuote('USDC', '100', 'USD');
      
      // Clear mock call history
      axios.get.mockClear();
      
      // Second call should use cache (within 1 minute)
      const quote2 = await anchorService.getOffRampQuote('USDC', '100', 'USD');

      expect(quote1).toEqual(quote2);
      // Cache should prevent any new API calls
      expect(axios.get).toHaveBeenCalledTimes(0); // No calls for cached result
    });
  });

  describe('getMultipleQuotes', () => {
    it('should return multiple quotes sorted by net payout', async () => {
      StellarTomlResolver.resolve.mockResolvedValue({
        TRANSFER_SERVER_SEP0024: 'https://testanchor.stellar.org/sep24'
      });

      // Mock two different anchor responses
      axios.get
        .mockResolvedValueOnce({
          data: {
            withdraw: {
              USDC: {
                enabled: true,
                fee_fixed: 2.5
              }
            }
          }
        })
        .mockResolvedValueOnce({ data: { price: 1.0 } })
        .mockResolvedValueOnce({
          data: {
            withdraw: {
              USDC: {
                enabled: true,
                fee_fixed: 1.5
              }
            }
          }
        })
        .mockResolvedValueOnce({ data: { price: 1.0 } });

      const quotes = await anchorService.getMultipleQuotes('USDC', '100', 'USD');

      expect(quotes.length).toBeGreaterThan(0);
      // Verify quotes are sorted by net payout (descending)
      for (let i = 1; i < quotes.length; i++) {
        expect(parseFloat(quotes[i - 1].netPayout)).toBeGreaterThanOrEqual(
          parseFloat(quotes[i].netPayout)
        );
      }
    });
  });

  describe('calculateFees', () => {
    it('should calculate fixed withdrawal fee correctly', () => {
      const assetInfo = {
        fee_fixed: 2.5
      };

      const fees = anchorService.calculateFees(100, assetInfo, 'USD');

      expect(fees.withdrawalFee).toBe(2.5);
      expect(fees.withdrawalFeeType).toBe('fixed');
      expect(fees.swapFee).toBeGreaterThan(0); // Should have swap fee
      expect(fees.totalFees).toBe(fees.swapFee + fees.withdrawalFee);
    });

    it('should calculate percentage withdrawal fee correctly', () => {
      const assetInfo = {
        fee_percent: 1.5 // 1.5%
      };

      const fees = anchorService.calculateFees(100, assetInfo, 'USD');

      expect(fees.withdrawalFee).toBe(1.5);
      expect(fees.withdrawalFeeType).toBe('percent');
      expect(fees.totalFees).toBeGreaterThan(fees.withdrawalFee);
    });

    it('should handle no withdrawal fee', () => {
      const assetInfo = {};

      const fees = anchorService.calculateFees(100, assetInfo, 'USD');

      expect(fees.withdrawalFee).toBe(0);
      expect(fees.withdrawalFeeType).toBe('none');
      expect(fees.totalFees).toBe(fees.swapFee);
    });
  });

  describe('validateQuoteRequest', () => {
    it('should validate correct parameters', () => {
      expect(() => {
        anchorService.validateQuoteRequest('USDC', '100', 'USD');
      }).not.toThrow();
    });

    it('should throw error for missing token symbol', () => {
      expect(() => {
        anchorService.validateQuoteRequest('', '100', 'USD');
      }).toThrow('Invalid token symbol');
    });

    it('should throw error for invalid amount', () => {
      expect(() => {
        anchorService.validateQuoteRequest('USDC', 'abc', 'USD');
      }).toThrow('Invalid token amount');
    });

    it('should throw error for unsupported fiat', () => {
      expect(() => {
        anchorService.validateQuoteRequest('USDC', '100', 'XYZ');
      }).toThrow('Unsupported fiat currency');
    });
  });

  describe('getSupportedAnchors', () => {
    it('should return list of supported anchors', () => {
      const anchors = anchorService.getSupportedAnchors();

      expect(Array.isArray(anchors)).toBe(true);
      expect(anchors.length).toBeGreaterThan(0);
      expect(anchors[0]).toHaveProperty('domain');
      expect(anchors[0]).toHaveProperty('asset');
      expect(anchors[0]).toHaveProperty('supported');
    });
  });
});
