const annualVestingStatementService = require('./annualVestingStatementService');
const { AnnualVestingStatement } = require('../models');
const { sequelize } = require('../database/connection');

describe('Annual Vesting Statement Service', () => {
  beforeEach(async () => {
    // Clean up database before each test
    await AnnualVestingStatement.destroy({ where: {}, force: true });
  });

  afterAll(async () => {
    // Close database connection after all tests
    await sequelize.close();
  });

  describe('generateAnnualStatement', () => {
    const mockUserAddress = '0x1234567890123456789012345678901234567890';
    const mockYear = 2024;

    it('should generate annual statement successfully', async () => {
      // Mock the dependencies
      jest.spyOn(annualVestingStatementService, 'getUserVaults').mockResolvedValue([]);
      jest.spyOn(annualVestingStatementService, 'aggregateVestingData').mockResolvedValue({
        userAddress: mockUserAddress,
        year: mockYear,
        summary: {
          totalVestedAmount: '1000',
          totalClaimedAmount: '500',
          totalUnclaimedAmount: '500',
          totalFMVUSD: '50000',
          totalRealizedGainsUSD: '25000',
          numberOfVaults: 2,
          numberOfClaims: 5,
        },
        vaults: [],
        claims: [],
        monthlyBreakdown: [],
      });

      jest.spyOn(annualVestingStatementService, 'generateStatementPDF').mockResolvedValue(Buffer.from('mock pdf'));
      jest.spyOn(annualVestingStatementService, 'signPDF').mockResolvedValue('mock-signature');
      jest.spyOn(annualVestingStatementService, 'savePDFToStorage').mockResolvedValue('/mock/path/statement.pdf');

      const result = await annualVestingStatementService.generateAnnualStatement(mockUserAddress, mockYear);

      expect(result).toBeDefined();
      expect(result.user_address).toBe(mockUserAddress);
      expect(result.year).toBe(mockYear);
      expect(result.total_vested_amount).toBe('1000');
      expect(result.digital_signature).toBe('mock-signature');
    });

    it('should return existing statement if already exists', async () => {
      // Create an existing statement
      await AnnualVestingStatement.create({
        user_address: mockUserAddress,
        year: mockYear,
        statement_data: { mock: 'data' },
        total_vested_amount: '1000',
      });

      const result = await annualVestingStatementService.generateAnnualStatement(mockUserAddress, mockYear);

      expect(result).toBeDefined();
      expect(result.user_address).toBe(mockUserAddress);
      expect(result.year).toBe(mockYear);
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(annualVestingStatementService, 'getUserVaults').mockRejectedValue(new Error('Database error'));

      await expect(
        annualVestingStatementService.generateAnnualStatement(mockUserAddress, mockYear)
      ).rejects.toThrow('Database error');
    });
  });

  describe('aggregateVestingData', () => {
    it('should aggregate vesting data correctly', async () => {
      const mockVaults = [
        {
          id: 'vault-1',
          token_address: '0xTOKEN',
          total_amount: '1000',
          token: { symbol: 'TOKEN' },
          organization: { name: 'Test Org' },
        },
      ];

      jest.spyOn(annualVestingStatementService, 'processVaultForYear').mockResolvedValue({
        totalVestedAmount: '500',
        totalClaimedAmount: '200',
        totalUnclaimedAmount: '300',
        totalFMVUSD: '25000',
        totalRealizedGainsUSD: '15000',
        claims: [],
      });

      const result = await annualVestingStatementService.aggregateVestingData(
        mockUserAddress,
        mockVaults,
        2024
      );

      expect(result.userAddress).toBe(mockUserAddress);
      expect(result.year).toBe(2024);
      expect(result.summary.totalVestedAmount).toBe('500');
      expect(result.summary.numberOfVaults).toBe(2);
    });
  });

  describe('calculateRealizedGains', () => {
    it('should calculate realized gains correctly', () => {
      const mockClaims = [
        {
          amount_claimed: '100',
          price_at_claim_usd: '10',
        },
        {
          amount_claimed: '200',
          price_at_claim_usd: '15',
        },
      ];

      const yearEndPrice = 20;

      const result = annualVestingStatementService.calculateRealizedGains(mockClaims, yearEndPrice);

      // First claim: (100 * 20) - (100 * 10) = 1000
      // Second claim: (200 * 20) - (200 * 15) = 1000
      // Total: 2000
      expect(result).toBe('2000');
    });
  });

  describe('signPDF', () => {
    it('should sign PDF with transparency key', async () => {
      const mockPDF = Buffer.from('mock pdf content');
      
      // Mock environment variables
      process.env.TRANSPARENCY_PRIVATE_KEY = 'mock-private-key';
      process.env.TRANSPARENCY_PUBLIC_KEY = 'mock-public-key';

      const result = await annualVestingStatementService.signPDF(mockPDF);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should throw error if transparency key is missing', async () => {
      delete process.env.TRANSPARENCY_PRIVATE_KEY;
      
      const mockPDF = Buffer.from('mock pdf content');

      await expect(
        annualVestingStatementService.signPDF(mockPDF)
      ).rejects.toThrow('TRANSPARENCY_PRIVATE_KEY and TRANSPARENCY_PUBLIC_KEY environment variables are required');
    });
  });

  describe('verifyStatementSignature', () => {
    it('should verify statement signature correctly', async () => {
      const mockStatement = {
        digital_signature: 'mock-signature',
        transparency_key_public_address: 'mock-public-key',
      };
      const mockPDF = Buffer.from('mock pdf content');

      jest.spyOn(AnnualVestingStatement, 'getStatementByUserAndYear').mockResolvedValue(mockStatement);

      const result = await annualVestingStatementService.verifyStatementSignature(
        mockUserAddress,
        2024,
        'mock-signature',
        mockPDF
      );

      expect(typeof result).toBe('boolean');
    });

    it('should return false for invalid signature', async () => {
      const mockStatement = {
        digital_signature: 'different-signature',
        transparency_key_public_address: 'mock-public-key',
      };
      const mockPDF = Buffer.from('mock pdf content');

      jest.spyOn(AnnualVestingStatement, 'getStatementByUserAndYear').mockResolvedValue(mockStatement);

      const result = await annualVestingStatementService.verifyStatementSignature(
        mockUserAddress,
        2024,
        'invalid-signature',
        mockPDF
      );

      expect(result).toBe(false);
    });
  });

  describe('utility methods', () => {
    it('should add decimals correctly', () => {
      const result = annualVestingStatementService.addDecimal('100.5', '200.3');
      expect(result).toBe('300.8');
    });

    it('should subtract decimals correctly', () => {
      const result = annualVestingStatementService.subtractDecimal('500', '200');
      expect(result).toBe('300');
    });

    it('should multiply decimals correctly', () => {
      const result = annualVestingStatementService.multiplyDecimal('100', '2.5');
      expect(result).toBe('250');
    });
  });
});

describe('Annual Statement PDF Service', () => {
  const annualStatementPDFService = require('./annualStatementPDFService');

  describe('generateAnnualStatement', () => {
    it('should generate PDF buffer successfully', async () => {
      const mockStatementData = {
        userAddress: '0x1234567890123456789012345678901234567890',
        year: 2024,
        summary: {
          totalVestedAmount: '1000',
          totalClaimedAmount: '500',
          totalUnclaimedAmount: '500',
          totalFMVUSD: '50000',
          totalRealizedGainsUSD: '25000',
          numberOfVaults: 2,
          numberOfClaims: 5,
        },
        vaults: [],
        claims: [],
        monthlyBreakdown: [],
        period: {
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2024-12-31T23:59:59.999Z',
        },
      };

      const result = await annualStatementPDFService.generateAnnualStatement(mockStatementData, 2024);

      expect(result).toBeDefined();
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should handle PDF generation errors', async () => {
      const invalidData = null;

      await expect(
        annualStatementPDFService.generateAnnualStatement(invalidData, 2024)
      ).rejects.toThrow();
    });
  });
});

describe('Annual Vesting Statement Model', () => {
  describe('class methods', () => {
    it('should get statement by user and year', async () => {
      const mockStatement = {
        user_address: '0x1234567890123456789012345678901234567890',
        year: 2024,
        total_vested_amount: '1000',
      };

      jest.spyOn(AnnualVestingStatement, 'findOne').mockResolvedValue(mockStatement);

      const result = await AnnualVestingStatement.getStatementByUserAndYear(
        '0x1234567890123456789012345678901234567890',
        2024
      );

      expect(result).toBe(mockStatement);
      expect(AnnualVestingStatement.findOne).toHaveBeenCalledWith({
        where: {
          user_address: '0x1234567890123456789012345678901234567890',
          year: 2024,
        },
      });
    });

    it('should get user statements with pagination', async () => {
      const mockStatements = {
        rows: [
          { id: 1, year: 2024, user_address: '0x123...' },
          { id: 2, year: 2023, user_address: '0x123...' },
        ],
        count: 2,
      };

      jest.spyOn(AnnualVestingStatement, 'findAndCountAll').mockResolvedValue(mockStatements);

      const result = await AnnualVestingStatement.getUserStatements(
        '0x1234567890123456789012345678901234567890',
        { limit: 10, offset: 0 }
      );

      expect(result).toBe(mockStatements);
      expect(AnnualVestingStatement.findAndCountAll).toHaveBeenCalledWith({
        where: {
          user_address: '0x1234567890123456789012345678901234567890',
          is_archived: false,
        },
        order: [['year', 'DESC']],
        limit: 10,
        offset: 0,
      });
    });
  });

  describe('instance methods', () => {
    it('should mark statement as accessed', async () => {
      const mockStatement = {
        accessed_at: null,
        save: jest.fn().mockResolvedValue(),
      };

      const result = await mockStatement.markAsAccessed();
      
      expect(mockStatement.accessed_at).toBeInstanceOf(Date);
      expect(mockStatement.save).toHaveBeenCalled();
      expect(result).toBe(mockStatement);
    });

    it('should archive statement', async () => {
      const mockStatement = {
        is_archived: false,
        save: jest.fn().mockResolvedValue(),
      };

      const result = await mockStatement.archive();
      
      expect(mockStatement.is_archived).toBe(true);
      expect(mockStatement.save).toHaveBeenCalled();
      expect(result).toBe(mockStatement);
    });
  });
});
