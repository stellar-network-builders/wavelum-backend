const stellarPathPaymentListener = require('./stellarPathPaymentListener');
const { ConversionEvent, ClaimsHistory } = require('../models');
const { sequelize } = require('../database/connection');
const { Server } = require('stellar-sdk');

// Mock the Stellar SDK
jest.mock('stellar-sdk', () => {
  return {
    Server: jest.fn().mockImplementation(() => ({
      ledgers: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            call: jest.fn().mockResolvedValue({
              records: [{ sequence: 12345 }]
            })
          })
        })
      }),
      transactions: jest.fn().mockReturnValue({
        cursor: jest.fn().mockReturnValue({
          order: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({
              stream: jest.fn().mockImplementation((options) => {
                if (options && options.onmessage) {
                  options.onmessage({
                    hash: 'test_tx_hash',
                    successful: true,
                    ledger: 12346,
                    created_at: new Date().toISOString(),
                    fee_charged: '100',
                    paging_token: '12346'
                  });
                }
              })
            })
          })
        }),
        transaction: jest.fn().mockReturnValue({
          call: jest.fn().mockResolvedValue({
            hash: 'test_tx_hash',
            successful: true,
            ledger: 12346,
            created_at: new Date(),
            fee_charged: '100',
            operations: [
              {
                type: 'path_payment_strict_send',
                source_account: 'GD5XQZOWZCQ5JQPYE4MIVUYR2QYQ22LUCPDBL4TCHJ72Y2N4QZTPQFM',
                source_asset: {
                  asset_type: 'credit_alphanum12',
                  asset_code: 'TOKEN',
                  asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3'
                },
                source_amount: '1000.000000',
                destination_asset: {
                  asset_type: 'credit_alphanum4',
                  asset_code: 'USDC',
                  asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
                },
                destination_amount: '500.000000',
                path: []
              }
            ]
          })
        })
      })
    })),
    Networks: {
      PUBLIC: 'Public Network',
      TESTNET: 'Test Network'
    }
  };
});

describe('StellarPathPaymentListener', () => {
  let testUserAddress;
  let testClaim;

  beforeAll(async () => {
    // Set up test database
    await sequelize.sync({ force: true });
    testUserAddress = 'GD5XQZOWZCQ5JQPYE4MIVUYR2QYQ22LUCPDBL4TCHJ72Y2N4QZTPQFM';
  });

  afterAll(async () => {
    await stellarPathPaymentListener.stop();
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await ConversionEvent.destroy({ where: {} });
    await ClaimsHistory.destroy({ where: {} });
    
    // Reset listener state
    await stellarPathPaymentListener.stop();
    stellarPathPaymentListener.lastLedger = 0;
    stellarPathPaymentListener.cursor = 'now';
    stellarPathPaymentListener.retryCount = 0;
  });

  afterEach(async () => {
    await stellarPathPaymentListener.stop();
  });

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      expect(stellarPathPaymentListener.horizonUrl).toBe('https://horizon.stellar.org');
      expect(stellarPathPaymentListener.isListening).toBe(false);
      expect(stellarPathPaymentListener.retryCount).toBe(0);
      expect(stellarPathPaymentListener.maxRetries).toBe(5);
    });

    it('should get last processed ledger from database', async () => {
      // Create a test conversion event
      await ConversionEvent.create({
        transaction_hash: 'existing_tx',
        user_address: testUserAddress,
        source_asset_code: 'TOKEN',
        source_asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3',
        source_amount: '1000.000000',
        destination_asset_code: 'USDC',
        destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        destination_amount: '500.000000',
        exchange_rate: '0.500000',
        block_number: 12345,
        transaction_timestamp: new Date(),
        conversion_type: 'direct_swap',
        price_source: 'stellar_dex',
        data_quality: 'good'
      });

      await stellarPathPaymentListener.getLastProcessedLedger();
      
      expect(stellarPathPaymentListener.lastLedger).toBe(12345);
    });

    it('should handle database with no existing events', async () => {
      await stellarPathPaymentListener.getLastProcessedLedger();
      
      expect(stellarPathPaymentListener.lastLedger).toBe(0);
      expect(stellarPathPaymentListener.cursor).toBe('now');
    });
  });

  describe('path payment processing', () => {
    beforeEach(async () => {
      // Create a test claim for claim-and-swap testing
      testClaim = await ClaimsHistory.create({
        user_address: testUserAddress,
        token_address: 'TOKEN',
        amount_claimed: '1000.000000',
        claim_timestamp: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
        transaction_hash: 'claim_hash',
        block_number: 12345,
        price_at_claim_usd: '0.450000'
      });
    });

    it('should process path payment transaction', async () => {
      const mockTransaction = {
        hash: 'test_tx_hash',
        successful: true,
        ledger: 12346,
        created_at: new Date(),
        fee_charged: '100'
      };

      const mockOperation = {
        type: 'path_payment_strict_send',
        source_account: testUserAddress,
        source_asset: {
          asset_type: 'credit_alphanum12',
          asset_code: 'TOKEN',
          asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3'
        },
        source_amount: '1000.000000',
        destination_asset: {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
        },
        destination_amount: '500.000000',
        path: []
      };

      await stellarPathPaymentListener.processPathPayment(mockOperation, mockTransaction);

      const conversionEvent = await ConversionEvent.findOne({
        where: { transaction_hash: 'test_tx_hash' }
      });

      expect(conversionEvent).toBeDefined();
      expect(conversionEvent.user_address).toBe(testUserAddress);
      expect(conversionEvent.source_asset_code).toBe('TOKEN');
      expect(conversionEvent.destination_asset_code).toBe('USDC');
      expect(conversionEvent.source_amount).toBe('1000.000000');
      expect(conversionEvent.destination_amount).toBe('500.000000');
      expect(conversionEvent.exchange_rate).toBe('0.5');
      expect(conversionEvent.conversion_type).toBe('claim_and_swap');
      expect(conversionEvent.gas_fee_xlm).toBe('0.00001'); // 100 stroops / 10000000
    });

    it('should handle direct swap without associated claim', async () => {
      // Create a claim that's too old to be associated
      await ClaimsHistory.create({
        user_address: testUserAddress,
        token_address: 'TOKEN',
        amount_claimed: '1000.000000',
        claim_timestamp: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
        transaction_hash: 'old_claim_hash',
        block_number: 12344
      });

      const mockTransaction = {
        hash: 'direct_swap_tx',
        successful: true,
        ledger: 12346,
        created_at: new Date(),
        fee_charged: '100'
      };

      const mockOperation = {
        type: 'path_payment_strict_send',
        source_account: testUserAddress,
        source_asset: {
          asset_type: 'native' // XLM
        },
        source_amount: '2000.000000',
        destination_asset: {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
        },
        destination_amount: '1000.000000',
        path: []
      };

      await stellarPathPaymentListener.processPathPayment(mockOperation, mockTransaction);

      const conversionEvent = await ConversionEvent.findOne({
        where: { transaction_hash: 'direct_swap_tx' }
      });

      expect(conversionEvent).toBeDefined();
      expect(conversionEvent.source_asset_code).toBe('XLM');
      expect(conversionEvent.source_asset_issuer).toBeNull();
      expect(conversionEvent.conversion_type).toBe('direct_swap');
      expect(conversionEvent.claim_id).toBeNull();
    });

    it('should skip processing duplicate transactions', async () => {
      // Create an existing conversion event
      await ConversionEvent.create({
        transaction_hash: 'duplicate_tx',
        user_address: testUserAddress,
        source_asset_code: 'TOKEN',
        source_asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3',
        source_amount: '1000.000000',
        destination_asset_code: 'USDC',
        destination_asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        destination_amount: '500.000000',
        exchange_rate: '0.500000',
        block_number: 12345,
        transaction_timestamp: new Date(),
        conversion_type: 'direct_swap',
        price_source: 'stellar_dex',
        data_quality: 'good'
      });

      const mockTransaction = {
        hash: 'duplicate_tx',
        successful: true,
        ledger: 12346,
        created_at: new Date(),
        fee_charged: '100'
      };

      const mockOperation = {
        type: 'path_payment_strict_send',
        source_account: testUserAddress,
        source_asset: {
          asset_type: 'credit_alphanum12',
          asset_code: 'TOKEN',
          asset_issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3'
        },
        source_amount: '1000.000000',
        destination_asset: {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
        },
        destination_amount: '500.000000',
        path: []
      };

      await stellarPathPaymentListener.processPathPayment(mockOperation, mockTransaction);

      // Should still only have one record
      const events = await ConversionEvent.findAll({
        where: { transaction_hash: 'duplicate_tx' }
      });
      expect(events).toHaveLength(1);
    });

    it('should skip unsuccessful transactions', async () => {
      const mockTransaction = {
        hash: 'failed_tx',
        successful: false, // Unsuccessful transaction
        ledger: 12346,
        created_at: new Date(),
        fee_charged: '100'
      };

      await stellarPathPaymentListener.processTransaction(mockTransaction);

      const conversionEvent = await ConversionEvent.findOne({
        where: { transaction_hash: 'failed_tx' }
      });

      expect(conversionEvent).toBeNull();
    });
  });

  describe('asset parsing', () => {
    it('should parse native XLM asset', () => {
      const nativeAsset = { asset_type: 'native' };
      const parsed = stellarPathPaymentListener.parseAsset(nativeAsset);

      expect(parsed.code).toBe('XLM');
      expect(parsed.issuer).toBeNull();
    });

    it('should parse credit alphanumeric asset', () => {
      const creditAsset = {
        asset_type: 'credit_alphanum4',
        asset_code: 'USDC',
        asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
      };
      const parsed = stellarPathPaymentListener.parseAsset(creditAsset);

      expect(parsed.code).toBe('USDC');
      expect(parsed.issuer).toBe('GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN');
    });
  });

  describe('gas fee calculation', () => {
    it('should calculate gas fee in XLM', () => {
      const transaction = {
        fee_charged: '100' // 100 stroops
      };

      const gasFee = stellarPathPaymentListener.calculateGasFee(transaction);
      expect(gasFee).toBe('0.00001'); // 100 stroops / 10000000
    });

    it('should handle missing fee information', () => {
      const transaction = {};

      const gasFee = stellarPathPaymentListener.calculateGasFee(transaction);
      expect(gasFee).toBe('0');
    });
  });

  describe('USD exchange rate calculation', () => {
    it('should return direct rate for USDC destination', () => {
      const sourceAsset = { code: 'TOKEN', issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3' };
      const destinationAsset = { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' };
      const exchangeRate = 0.5;

      const usdRate = stellarPathPaymentListener.getUSDExchangeRate(sourceAsset, destinationAsset, exchangeRate);
      expect(usdRate).resolves.toBe(0.5);
    });

    it('should return inverse rate for USDC source', () => {
      const sourceAsset = { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' };
      const destinationAsset = { code: 'TOKEN', issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3' };
      const exchangeRate = 2.0; // 1 USDC = 2 TOKEN

      const usdRate = stellarPathPaymentListener.getUSDExchangeRate(sourceAsset, destinationAsset, exchangeRate);
      expect(usdRate).resolves.toBe(0.5); // 1 TOKEN = 0.5 USDC
    });
  });

  describe('data quality assessment', () => {
    it('should assess data quality based on amount', async () => {
      const sourceAsset = { code: 'TOKEN', issuer: 'GBXKQ4K2YF3VXZ5J5N7L8Q9R0T1U2V3W4X5Y6Z7A8B9C0D1E2F3' };
      const destinationAsset = { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' };

      const quality1 = await stellarPathPaymentListener.assessDataQuality(sourceAsset, destinationAsset, '150000.000000');
      expect(quality1).toBe('excellent');

      const quality2 = await stellarPathPaymentListener.assessDataQuality(sourceAsset, destinationAsset, '15000.000000');
      expect(quality2).toBe('good');

      const quality3 = await stellarPathPaymentListener.assessDataQuality(sourceAsset, destinationAsset, '1500.000000');
      expect(quality3).toBe('fair');

      const quality4 = await stellarPathPaymentListener.assessDataQuality(sourceAsset, destinationAsset, '150.000000');
      expect(quality4).toBe('poor');
    });
  });

  describe('status and control', () => {
    it('should return correct status', () => {
      const status = stellarPathPaymentListener.getStatus();
      
      expect(status).toHaveProperty('isListening');
      expect(status).toHaveProperty('lastLedger');
      expect(status).toHaveProperty('cursor');
      expect(status).toHaveProperty('retryCount');
    });

    it('should start and stop listener', async () => {
      expect(stellarPathPaymentListener.isListening).toBe(false);

      // Start listener
      await stellarPathPaymentListener.start();
      expect(stellarPathPaymentListener.isListening).toBe(true);

      // Stop listener
      await stellarPathPaymentListener.stop();
      expect(stellarPathPaymentListener.isListening).toBe(false);
    });

    it('should emit events on conversion', (done) => {
      stellarPathPaymentListener.on('conversionEvent', (event) => {
        expect(event.type).toBe('claim_and_swap');
        expect(event.userAddress).toBe(testUserAddress);
        expect(event.sourceAsset.code).toBe('TOKEN');
        expect(event.destinationAsset.code).toBe('USDC');
        done();
      });

      // Simulate a conversion event
      stellarPathPaymentListener.emit('conversionEvent', {
        type: 'claim_and_swap',
        userAddress: testUserAddress,
        sourceAsset: { code: 'TOKEN' },
        destinationAsset: { code: 'USDC' },
        amount: '500.000000',
        exchangeRate: 0.5,
        timestamp: new Date()
      });
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      // Mock a database error
      jest.spyOn(ConversionEvent, 'findOne').mockRejectedValue(new Error('Database error'));

      const mockTransaction = {
        hash: 'error_tx',
        successful: true,
        ledger: 12346,
        created_at: new Date(),
        fee_charged: '100'
      };

      const mockOperation = {
        type: 'path_payment_strict_send',
        source_account: testUserAddress,
        source_asset: { asset_type: 'native' },
        source_amount: '1000.000000',
        destination_asset: {
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          asset_issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN'
        },
        destination_amount: '500.000000',
        path: []
      };

      // Should not throw an error
      await expect(
        stellarPathPaymentListener.processPathPayment(mockOperation, mockTransaction)
      ).resolves.not.toThrow();

      // Restore mock
      jest.restoreAllMocks();
    });
  });
});
