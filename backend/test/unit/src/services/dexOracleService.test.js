const dexOracleService = require('./dexOracleService');
const priceService = require('./priceService');
const stellarDexPriceService = require('./stellarDexPriceService');

// Mock the price services
jest.mock('./priceService');
jest.mock('./stellarDexPriceService');

describe('DexOracleService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    dexOracleService.clearCache();
  });

  describe('getCurrentPrice', () => {
    const tokenAddress = 'TOKEN_ADDRESS_1';

    test('should aggregate prices from multiple sources', async () => {
      // Mock responses from different sources
      stellarDexPriceService.getTokenVWAP.mockResolvedValue({
        price_usd: '100.00',
        vwap_24h_usd: '100.00',
        volume_24h_usd: '50000',
        data_quality: 'good'
      });

      priceService.getCoinGeckoPrice.mockResolvedValue('101.50');
      priceService.getCoinMarketCapLatestPrice.mockResolvedValue('99.75');

      const result = await dexOracleService.getCurrentPrice(tokenAddress);

      expect(result).toBeDefined();
      expect(result.token_address).toBe(tokenAddress);
      expect(result.price_usd).toBeDefined();
      expect(result.confidence_score).toBeGreaterThan(0);
      expect(result.sources).toHaveLength(3);
      expect(result.source_count).toBe(3);
    });

    test('should handle source failures gracefully', async () => {
      stellarDexPriceService.getTokenVWAP.mockResolvedValue({
        price_usd: '100.00',
        vwap_24h_usd: '100.00',
        volume_24h_usd: '50000',
        data_quality: 'good'
      });

      priceService.getCoinGeckoPrice.mockRejectedValue(new Error('Service unavailable'));
      priceService.getCoinMarketCapLatestPrice.mockRejectedValue(new Error('Service unavailable'));

      const result = await dexOracleService.getCurrentPrice(tokenAddress);

      expect(result).toBeDefined();
      expect(result.sources).toHaveLength(1);
      expect(result.source_count).toBe(1);
    });

    test('should throw error when all sources fail', async () => {
      stellarDexPriceService.getTokenVWAP.mockRejectedValue(new Error('DEX unavailable'));
      priceService.getCoinGeckoPrice.mockRejectedValue(new Error('CG unavailable'));
      priceService.getCoinMarketCapLatestPrice.mockRejectedValue(new Error('CMC unavailable'));

      await expect(dexOracleService.getCurrentPrice(tokenAddress))
        .rejects.toThrow('No valid price data available');
    });

    test('should use cache for repeated requests', async () => {
      stellarDexPriceService.getTokenVWAP.mockResolvedValue({
        price_usd: '100.00',
        vwap_24h_usd: '100.00',
        volume_24h_usd: '50000',
        data_quality: 'good'
      });

      // First call
      await dexOracleService.getCurrentPrice(tokenAddress);
      
      // Second call should use cache
      const result = await dexOracleService.getCurrentPrice(tokenAddress);

      expect(result).toBeDefined();
      expect(stellarDexPriceService.getTokenVWAP).toHaveBeenCalledTimes(1);
    });

    test('should respect minimum confidence threshold', async () => {
      // Mock low confidence data
      stellarDexPriceService.getTokenVWAP.mockResolvedValue({
        price_usd: '100.00',
        vwap_24h_usd: '100.00',
        volume_24h_usd: '10', // Very low volume
        data_quality: 'poor'
      });

      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      await dexOracleService.getCurrentPrice(tokenAddress, { minConfidence: 0.9 });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Low confidence')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('getHistoricalPrice', () => {
    const tokenAddress = 'TOKEN_ADDRESS_1';
    const historicalDate = new Date('2023-01-01');

    test('should get historical price from multiple sources', async () => {
      stellarDexPriceService.getTokenVWAP.mockResolvedValue({
        price_usd: '80.00',
        vwap_24h_usd: '80.00',
        data_quality: 'good'
      });

      priceService.getCoinGeckoHistoricalPrice.mockResolvedValue('82.50');

      const result = await dexOracleService.getHistoricalPrice(tokenAddress, historicalDate);

      expect(result).toBeDefined();
      expect(result.token_address).toBe(tokenAddress);
      expect(result.price_date).toEqual(historicalDate);
      expect(result.price_usd).toBeDefined();
      expect(result.sources).toHaveLength(2);
    });

    test('should handle historical price failures', async () => {
      stellarDexPriceService.getTokenVWAP.mockRejectedValue(new Error('No historical data'));
      priceService.getCoinGeckoHistoricalPrice.mockRejectedValue(new Error('No historical data'));

      await expect(dexOracleService.getHistoricalPrice(tokenAddress, historicalDate))
        .rejects.toThrow('No valid historical price data available');
    });

    test('should use longer cache for historical data', async () => {
      stellarDexPriceService.getTokenVWAP.mockResolvedValue({
        price_usd: '80.00',
        vwap_24h_usd: '80.00',
        data_quality: 'good'
      });

      // First call
      await dexOracleService.getHistoricalPrice(tokenAddress, historicalDate);
      
      // Second call should use cache
      const result = await dexOracleService.getHistoricalPrice(tokenAddress, historicalDate);

      expect(result).toBeDefined();
      expect(stellarDexPriceService.getTokenVWAP).toHaveBeenCalledTimes(1);
    });
  });

  describe('getSource implementations', () => {
    test('getStellarDexPrice should format data correctly', async () => {
      const mockDexData = {
        vwap_24h_usd: '100.50',
        volume_24h_usd: '75000',
        data_quality: 'excellent'
      };

      stellarDexPriceService.getTokenVWAP.mockResolvedValue(mockDexData);

      const result = await dexOracleService.getPriceFromSource('TOKEN1', 'stellar_dex');

      expect(result.source).toBe('stellar_dex');
      expect(result.price).toBe(100.50);
      expect(result.volume).toBe(75000);
      expect(result.confidence).toBe(0.85);
    });

    test('getCoinGeckoPrice should format data correctly', async () => {
      priceService.getCoinGeckoPrice.mockResolvedValue('105.75');

      const result = await dexOracleService.getPriceFromSource('TOKEN1', 'coingecko');

      expect(result.source).toBe('coingecko');
      expect(result.price).toBe(105.75);
      expect(result.volume).toBe(0);
      expect(result.confidence).toBe(0.80);
    });

    test('getCoinMarketCapPrice should format data correctly', async () => {
      priceService.getCoinMarketCapLatestPrice.mockResolvedValue('98.25');

      const result = await dexOracleService.getPriceFromSource('TOKEN1', 'coinmarketcap');

      expect(result.source).toBe('coinmarketcap');
      expect(result.price).toBe(98.25);
      expect(result.volume).toBe(0);
      expect(result.confidence).toBe(0.82);
    });

    test('should handle unsupported sources', async () => {
      await expect(dexOracleService.getPriceFromSource('TOKEN1', 'unsupported'))
        .rejects.toThrow('Unsupported price source: unsupported');
    });

    test('should handle Uniswap integrations (not implemented)', async () => {
      await expect(dexOracleService.getPriceFromSource('TOKEN1', 'uniswap_v2'))
        .rejects.toThrow('Uniswap V2 integration not implemented');

      await expect(dexOracleService.getPriceFromSource('TOKEN1', 'uniswap_v3'))
        .rejects.toThrow('Uniswap V3 integration not implemented');
    });
  });

  describe('calculateWeightedPrice', () => {
    test('should calculate weighted average correctly', () => {
      const priceData = [
        { source: 'stellar_dex', price: 100, confidence: 0.9, volume: 50000 },
        { source: 'coingecko', price: 102, confidence: 0.8, volume: 0 },
        { source: 'coinmarketcap', price: 99, confidence: 0.85, volume: 0 }
      ];

      const result = dexOracleService.calculateWeightedPrice(priceData);

      expect(result).toBeGreaterThan(99);
      expect(result).toBeLessThan(102);
    });

    test('should handle single price data', () => {
      const priceData = [
        { source: 'stellar_dex', price: 100, confidence: 0.9, volume: 50000 }
      ];

      const result = dexOracleService.calculateWeightedPrice(priceData);

      expect(result).toBe(100);
    });

    test('should handle empty price data', () => {
      const result = dexOracleService.calculateWeightedPrice([]);

      expect(result).toBe(0);
    });
  });

  describe('calculateConfidence', () => {
    test('should calculate high confidence for consistent prices', () => {
      const priceData = [
        { price: 100, confidence: 0.9 },
        { price: 101, confidence: 0.85 },
        { price: 99.5, confidence: 0.8 }
      ];

      const result = dexOracleService.calculateConfidence(priceData);

      expect(result).toBeGreaterThan(0.8);
    });

    test('should calculate low confidence for inconsistent prices', () => {
      const priceData = [
        { price: 100, confidence: 0.9 },
        { price: 150, confidence: 0.85 },
        { price: 50, confidence: 0.8 }
      ];

      const result = dexOracleService.calculateConfidence(priceData);

      expect(result).toBeLessThan(0.5);
    });

    test('should handle single price data', () => {
      const priceData = [
        { price: 100, confidence: 0.9 }
      ];

      const result = dexOracleService.calculateConfidence(priceData);

      expect(result).toBe(0.9);
    });

    test('should handle empty price data', () => {
      const result = dexOracleService.calculateConfidence([]);

      expect(result).toBe(0);
    });
  });

  describe('calculateSourceWeight', () => {
    test('should give higher weight to reliable sources', () => {
      const stellarWeight = dexOracleService.calculateSourceWeight('stellar_dex', 0.9, 50000);
      const cgWeight = dexOracleService.calculateSourceWeight('coingecko', 0.9, 0);

      expect(stellarWeight).toBeGreaterThan(cgWeight);
    });

    test('should adjust weight based on confidence', () => {
      const highConfidence = dexOracleService.calculateSourceWeight('stellar_dex', 0.95, 50000);
      const lowConfidence = dexOracleService.calculateSourceWeight('stellar_dex', 0.7, 50000);

      expect(highConfidence).toBeGreaterThan(lowConfidence);
    });

    test('should adjust weight based on volume', () => {
      const highVolume = dexOracleService.calculateSourceWeight('stellar_dex', 0.9, 100000);
      const lowVolume = dexOracleService.calculateSourceWeight('stellar_dex', 0.9, 1000);

      expect(highVolume).toBeGreaterThan(lowVolume);
    });

    test('should cap volume bonus', () => {
      const extremeVolume = dexOracleService.calculateSourceWeight('stellar_dex', 0.9, 10000000);
      const highVolume = dexOracleService.calculateSourceWeight('stellar_dex', 0.9, 200000);

      // The difference should be capped due to 2x weight limit
      expect(extremeVolume).toBeLessThan(highVolume * 2.1);
    });
  });

  describe('getOracleHealth', () => {
    test('should check health of all sources', async () => {
      // Mock successful responses
      stellarDexPriceService.getTokenVWAP.mockResolvedValue({ price_usd: '100' });
      priceService.getCoinGeckoPrice.mockResolvedValue('100');
      priceService.getCoinMarketCapLatestPrice.mockResolvedValue('100');

      const health = await dexOracleService.getOracleHealth();

      expect(health.status).toBe('healthy');
      expect(health.sources).toBeDefined();
      expect(health.cache_size).toBe(0);
      expect(health.uptime).toBeGreaterThan(0);

      // Check that all sources were tested
      expect(Object.keys(health.sources)).toContain('stellar_dex');
      expect(Object.keys(health.sources)).toContain('coingecko');
      expect(Object.keys(health.sources)).toContain('coinmarketcap');
      expect(Object.keys(health.sources)).toContain('uniswap_v2');
      expect(Object.keys(health.sources)).toContain('uniswap_v3');
    });

    test('should report degraded status when sources fail', async () => {
      // Mock some failures
      stellarDexPriceService.getTokenVWAP.mockResolvedValue({ price_usd: '100' });
      priceService.getCoinGeckoPrice.mockRejectedValue(new Error('Service down'));
      priceService.getCoinMarketCapLatestPrice.mockResolvedValue('100');

      const health = await dexOracleService.getOracleHealth();

      expect(health.status).toBe('degraded');
      expect(health.sources.coingecko.status).toBe('unhealthy');
      expect(health.sources.stellar_dex.status).toBe('healthy');
    });

    test('should measure response times', async () => {
      // Mock delayed response
      stellarDexPriceService.getTokenVWAP.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({ price_usd: '100' }), 100))
      );

      const health = await dexOracleService.getOracleHealth();

      expect(health.sources.stellar_dex.response_time_ms).toBeGreaterThan(90);
    });
  });

  describe('utility methods', () => {
    test('getSupportedSources should return all sources', () => {
      const sources = dexOracleService.getSupportedSources();

      expect(sources).toContain('stellar_dex');
      expect(sources).toContain('coingecko');
      expect(sources).toContain('coinmarketcap');
      expect(sources).toContain('uniswap_v2');
      expect(sources).toContain('uniswap_v3');
    });

    test('clearCache should remove all cached data', () => {
      // Add some data to cache
      dexOracleService.cache.set('test1', { data: 'test1' });
      dexOracleService.cache.set('test2', { data: 'test2' });
      expect(dexOracleService.cache.size).toBe(2);

      dexOracleService.clearCache();
      expect(dexOracleService.cache.size).toBe(0);
    });

    test('getAverageVolume should handle zero volumes', () => {
      const priceData = [
        { volume: 0 },
        { volume: 0 },
        { volume: 0 }
      ];

      const result = dexOracleService.getAverageVolume(priceData);
      expect(result).toBe(0);
    });

    test('getAveragePriceChange should handle missing data', () => {
      const priceData = [
        { metadata: { price_change_24h: 5.5 } },
        { metadata: {} }, // Missing price change
        { metadata: { price_change_24h: -2.3 } }
      ];

      const result = dexOracleService.getAveragePriceChange(priceData);
      expect(result).toBe(1.6); // (5.5 + -2.3) / 2
    });
  });

  describe('error handling', () => {
    test('should handle network timeouts gracefully', async () => {
      stellarDexPriceService.getTokenVWAP.mockRejectedValue(new Error('timeout'));
      priceService.getCoinGeckoPrice.mockRejectedValue(new Error('timeout'));
      priceService.getCoinMarketCapLatestPrice.mockRejectedValue(new Error('timeout'));

      await expect(dexOracleService.getCurrentPrice('TOKEN1'))
        .rejects.toThrow('No valid price data available');
    });

    test('should handle malformed data gracefully', async () => {
      stellarDexPriceService.getTokenVWAP.mockResolvedValue(null);
      priceService.getCoinGeckoPrice.mockRejectedValue(new Error('Invalid data'));
      priceService.getCoinMarketCapLatestPrice.mockRejectedValue(new Error('Invalid data'));

      await expect(dexOracleService.getCurrentPrice('TOKEN1'))
        .rejects.toThrow('No valid price data available');
    });
  });
});
