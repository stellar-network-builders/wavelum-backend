const capTableService = require('../capTableService');
const { Vault, SubSchedule, Beneficiary, Organization, Token } = require('../../models');

describe('CapTableService', () => {
  describe('generateCapTable', () => {
    it('should generate an empty cap table for token with no vaults', async () => {
      // Mock the database calls
      jest.spyOn(Vault, 'findAll').mockResolvedValue([]);
      
      const result = await capTableService.generateCapTable('0x1234567890123456789012345678901234567890');
      
      expect(result).toEqual({
        tokenAddress: '0x1234567890123456789012345678901234567890',
        tokenInfo: {
          address: '0x1234567890123456789012345678901234567890',
          symbol: 'UNKNOWN',
          name: 'Unknown Token',
          decimals: 18
        },
        totalSupply: '0',
        totalAllocated: '0',
        totalUnallocated: '0',
        totalBeneficiaries: 0,
        totalVaults: 0,
        beneficiaryHoldings: [],
        organizationBreakdown: [],
        summary: {
          totalAllocated: '0',
          totalVested: '0',
          totalWithdrawn: '0',
          totalUnallocated: '0',
          vestingProgress: 0,
          averageHoldingPerBeneficiary: 0,
          topHolderPercentage: 0,
          top10Percentage: 0,
          activeVaults: 0,
          totalVaults: 0
        },
        generatedAt: expect.any(Date)
      });
    });

    it('should calculate ownership percentages correctly', async () => {
      const mockHoldings = [
        { totalVested: 100, totalAllocated: 150 },
        { totalVested: 50, totalAllocated: 75 },
        { totalVested: 25, totalAllocated: 25 }
      ];
      
      const result = capTableService.calculateOwnershipPercentages(mockHoldings, 200);
      
      expect(result[0].ownershipPercentage).toBe(50); // 100/200 * 100
      expect(result[0].fullyDilutedOwnership).toBe(75); // 150/200 * 100
      expect(result[1].ownershipPercentage).toBe(25); // 50/200 * 100
      expect(result[2].ownershipPercentage).toBe(12.5); // 25/200 * 100
    });
  });

  describe('calculateGiniCoefficient', () => {
    it('should return 0 for empty array', () => {
      expect(capTableService.calculateGiniCoefficient([])).toBe(0);
    });

    it('should return 0 for equal distribution', () => {
      expect(capTableService.calculateGiniCoefficient([100, 100, 100])).toBe(0);
    });

    it('should calculate Gini coefficient correctly', () => {
      const result = capTableService.calculateGiniCoefficient([0, 50, 100]);
      expect(result).toBeCloseTo(0.33, 2);
    });
  });

  describe('calculateHHI', () => {
    it('should calculate Herfindahl-Hirschman Index correctly', () => {
      const percentages = [50, 30, 20];
      const result = capTableService.calculateHHI(percentages);
      expect(result).toBe(3800); // 50^2 + 30^2 + 20^2
    });
  });

  describe('getConcentrationMetrics', () => {
    it('should return empty metrics for no holdings', async () => {
      jest.spyOn(capTableService, 'generateCapTable').mockResolvedValue({
        beneficiaryHoldings: [],
        summary: { totalVested: '0' }
      });

      const result = await capTableService.getConcentrationMetrics('0x123');
      
      expect(result.totalBeneficiaries).toBe(0);
      expect(result.top1Percentage).toBe(0);
      expect(result.giniCoefficient).toBe(0);
      expect(result.hhi).toBe(0);
    });

    it('should calculate concentration metrics correctly', async () => {
      const mockHoldings = [
        { totalVested: '100' },
        { totalVested: '50' },
        { totalVested: '25' },
        { totalVested: '15' },
        { totalVested: '10' }
      ];

      jest.spyOn(capTableService, 'generateCapTable').mockResolvedValue({
        beneficiaryHoldings: mockHoldings,
        summary: { totalVested: '200' }
      });

      const result = await capTableService.getConcentrationMetrics('0x123');
      
      expect(result.totalBeneficiaries).toBe(5);
      expect(result.top1Percentage).toBe(50); // 100/200 * 100
      expect(result.top5Percentage).toBe(100); // All holdings
    });
  });

  describe('searchBeneficiaries', () => {
    it('should search beneficiaries by address', async () => {
      const mockHoldings = [
        { beneficiaryAddress: '0x123', organizations: ['Company A'] },
        { beneficiaryAddress: '0x456', organizations: ['Company B'] },
        { beneficiaryAddress: '0x789', organizations: ['Company A'] }
      ];

      jest.spyOn(capTableService, 'generateCapTable').mockResolvedValue({
        beneficiaryHoldings: mockHoldings
      });

      const result = await capTableService.searchBeneficiaries('0x123', '123');
      
      expect(result).toHaveLength(1);
      expect(result[0].beneficiaryAddress).toBe('0x123');
    });

    it('should search beneficiaries by organization', async () => {
      const mockHoldings = [
        { beneficiaryAddress: '0x123', organizations: ['Company A'] },
        { beneficiaryAddress: '0x456', organizations: ['Company B'] },
        { beneficiaryAddress: '0x789', organizations: ['Company A'] }
      ];

      jest.spyOn(capTableService, 'generateCapTable').mockResolvedValue({
        beneficiaryHoldings: mockHoldings
      });

      const result = await capTableService.searchBeneficiaries('0x123', 'Company A');
      
      expect(result).toHaveLength(2);
    });
  });
});
