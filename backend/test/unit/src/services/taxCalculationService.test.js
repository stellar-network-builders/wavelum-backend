/**
 * Tests for TaxCalculationService
 */

const taxCalculationService = require('./taxCalculationService');
const taxOracleService = require('./taxOracleService');
const { TaxCalculation, TaxJurisdiction, Vault, SubSchedule } = require('../models');
const { sequelize } = require('../database/connection');

// Mock the tax oracle service
jest.mock('./taxOracleService');
jest.mock('./priceService');

describe('TaxCalculationService', () => {
  let testVault, testSubSchedule, testJurisdiction;

  beforeAll(async () => {
    // Setup test database
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    // Clean up test database
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await TaxCalculation.destroy({ where: {} });
    await Vault.destroy({ where: {} });
    await SubSchedule.destroy({ where: {} });
    await TaxJurisdiction.destroy({ where: {} });

    // Create test jurisdiction
    testJurisdiction = await TaxJurisdiction.create({
      jurisdiction_code: 'US',
      jurisdiction_name: 'United States',
      currency: 'USD',
      tax_year_type: 'CALENDAR',
      tax_filing_deadline: '04-15',
      crypto_tax_treatment: 'CAPITAL_GAINS',
      vesting_tax_event: true,
      short_term_capital_gains_rate: 37.0,
      long_term_capital_gains_rate: 20.0,
      long_term_holding_period_days: 365,
      tax_withholding_required: false,
      sell_to_cover_allowed: true
    });

    // Create test vault
    testVault = await Vault.create({
      address: '0x1234567890123456789012345678901234567890',
      name: 'Test Vault',
      token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      owner_address: '0xownerownerownerownerownerownerownerowner',
      total_amount: '1000000'
    });

    // Create test subschedule
    testSubSchedule = await SubSchedule.create({
      vault_id: testVault.id,
      beneficiary_address: '0xuseruseruseruseruseruseruseruseruseruser',
      vesting_start_date: new Date('2024-01-01'),
      vesting_duration: 365 * 24 * 60 * 60, // 1 year in seconds
      cliff_date: new Date('2024-01-01'),
      top_up_amount: '1000'
    });
  });

  describe('calculateVestingTax', () => {
    test('should calculate vesting tax successfully', async () => {
      // Mock tax oracle response
      taxOracleService.getTaxRates.mockResolvedValue({
        provider: 'internal',
        data: {
          tax_rate: 20.0,
          tax_treatment: 'CAPITAL_GAINS',
          filing_deadline: new Date('2025-04-15')
        }
      });

      taxOracleService.calculateTaxLiability.mockResolvedValue({
        provider: 'internal',
        data: {
          tax_liability: 200.0,
          tax_rate_percent: 20.0,
          taxable_income: 1000.0,
          filing_deadline: new Date('2025-04-15')
        }
      });

      // Mock price service
      const priceService = require('./priceService');
      priceService.getTokenPrice.mockResolvedValue('10.0');

      const result = await taxCalculationService.calculateVestingTax({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        jurisdiction: 'US',
        taxYear: 2024,
        vestingDate: new Date('2024-06-01'),
        tokenPrice: '10.0',
        vestedAmount: '100',
        costBasis: '0'
      });

      expect(result).toBeDefined();
      expect(result.summary.taxLiability).toBe(200.0);
      expect(result.summary.taxableIncome).toBe(1000.0);
      expect(result.summary.taxRate).toBe(20.0);
      expect(result.sellToCover.tokensNeeded).toBeGreaterThan(0);
      expect(result.taxCalculation).toBeDefined();
    });

    test('should handle missing required parameters', async () => {
      await expect(taxCalculationService.calculateVestingTax({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        // Missing jurisdiction, taxYear, vestingDate, vestedAmount
      })).rejects.toThrow();
    });

    test('should use sell-to-cover calculation with buffer', async () => {
      taxOracleService.getTaxRates.mockResolvedValue({
        provider: 'internal',
        data: { tax_rate: 20.0 }
      });

      taxOracleService.calculateTaxLiability.mockResolvedValue({
        provider: 'internal',
        data: {
          tax_liability: 100.0,
          tax_rate_percent: 20.0,
          taxable_income: 500.0
        }
      });

      const priceService = require('./priceService');
      priceService.getTokenPrice.mockResolvedValue('10.0');

      const result = await taxCalculationService.calculateVestingTax({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        jurisdiction: 'US',
        taxYear: 2024,
        vestingDate: new Date('2024-06-01'),
        tokenPrice: '10.0',
        vestedAmount: '100',
        costBasis: '0'
      });

      // Should calculate tokens needed with 5% buffer
      const expectedTokens = (100.0 * 1.05) / 10.0; // 10.5 tokens
      expect(result.sellToCover.tokensNeeded).toBeCloseTo(10.5, 1);
    });
  });

  describe('calculateClaimTax', () => {
    test('should calculate claim tax successfully', async () => {
      taxOracleService.getTaxRates.mockResolvedValue({
        provider: 'internal',
        data: { tax_rate: 20.0 }
      });

      taxOracleService.calculateTaxLiability.mockResolvedValue({
        provider: 'internal',
        data: {
          tax_liability: 150.0,
          tax_rate_percent: 20.0,
          taxable_income: 750.0
        }
      });

      const priceService = require('./priceService');
      priceService.getTokenPrice.mockResolvedValue('10.0');

      const result = await taxCalculationService.calculateClaimTax({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        jurisdiction: 'US',
        taxYear: 2024,
        claimDate: new Date('2024-06-01'),
        tokenPrice: '10.0',
        claimedAmount: '75',
        costBasis: '0'
      });

      expect(result.summary.claimedAmount).toBe('75');
      expect(result.summary.taxLiability).toBe(150.0);
      expect(result.taxCalculation.tax_event_type).toBe('CLAIM');
    });
  });

  describe('getWithholdingEstimate', () => {
    test('should calculate withholding estimate', async () => {
      // Create some tax calculations
      await TaxCalculation.createTaxCalculation({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        taxJurisdiction: 'US',
        taxYear: 2024,
        taxEventType: 'VESTING',
        taxEventDate: new Date('2024-01-01'),
        tokenAddress: testVault.token_address,
        tokenPriceUsd: '10.0',
        vestedAmount: '100',
        costBasisUsd: '0',
        fairMarketValueUsd: '1000',
        taxRatePercent: 20.0
      });

      taxOracleService.getWithholdingRequirements.mockResolvedValue({
        provider: 'internal',
        data: {
          withholding_required: false,
          default_withholding_rate: 0
        }
      });

      const estimate = await taxCalculationService.getWithholdingEstimate(
        '0xuseruseruseruseruseruseruseruseruseruser',
        { jurisdiction: 'US', taxYear: 2024 }
      );

      expect(estimate.totalTaxLiability).toBe(200.0); // 1000 * 20%
      expect(estimate.totalWithheld).toBe(0);
      expect(estimate.recommendedWithholding).toBe(0);
      expect(estimate.calculations).toHaveLength(1);
    });

    test('should return zero for user with no calculations', async () => {
      taxOracleService.getWithholdingRequirements.mockResolvedValue({
        provider: 'internal',
        data: { withholding_required: false }
      });

      const estimate = await taxCalculationService.getWithholdingEstimate(
        '0xunknownuserunknownuserunknownuserunknown',
        {}
      );

      expect(estimate.totalTaxLiability).toBe(0);
      expect(estimate.totalWithheld).toBe(0);
      expect(estimate.calculations).toHaveLength(0);
    });
  });

  describe('getUserTaxProfile', () => {
    test('should get user tax profile', async () => {
      // Create tax calculations
      await TaxCalculation.createTaxCalculation({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        taxJurisdiction: 'US',
        taxYear: 2024,
        taxEventType: 'VESTING',
        taxEventDate: new Date('2024-01-01'),
        tokenAddress: testVault.token_address,
        tokenPriceUsd: '10.0',
        vestedAmount: '100',
        costBasisUsd: '0',
        fairMarketValueUsd: '1000',
        taxRatePercent: 20.0,
        userConfirmed: true
      });

      const profile = await taxCalculationService.getUserTaxProfile(
        '0xuseruseruseruseruseruseruseruseruseruser'
      );

      expect(profile.userAddress).toBe('0xuseruseruseruseruseruseruseruseruseruser');
      expect(profile.jurisdictions).toContain('US');
      expect(profile.primaryJurisdiction).toBe('US');
      expect(profile.totalTaxLiabilities).toBe(200.0);
      expect(profile.taxEvents).toHaveLength(1);
      expect(profile.preferences.confirmations).toHaveLength(1);
    });

    test('should return empty profile for user with no tax events', async () => {
      const profile = await taxCalculationService.getUserTaxProfile(
        '0xunknownuserunknownuserunknownuserunknown'
      );

      expect(profile.userAddress).toBe('0xunknownuserunknownuserunknownuserunknown');
      expect(profile.jurisdictions).toHaveLength(0);
      expect(profile.primaryJurisdiction).toBeNull();
      expect(profile.totalTaxLiabilities).toBe(0);
      expect(profile.taxEvents).toHaveLength(0);
    });
  });

  describe('getYearlyTaxSummary', () => {
    test('should get yearly tax summary', async () => {
      await TaxCalculation.createTaxCalculation({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        taxJurisdiction: 'US',
        taxYear: 2024,
        taxEventType: 'VESTING',
        taxEventDate: new Date('2024-01-01'),
        tokenAddress: testVault.token_address,
        tokenPriceUsd: '10.0',
        vestedAmount: '100',
        costBasisUsd: '0',
        fairMarketValueUsd: '1000',
        taxRatePercent: 20.0
      });

      const summary = await taxCalculationService.getYearlyTaxSummary(
        '0xuseruseruseruseruseruseruseruseruseruser',
        2024
      );

      expect(summary.taxYear).toBe(2024);
      expect(summary.totalTaxableIncome).toBe(1000.0);
      expect(summary.totalTaxLiability).toBe(200.0);
      expect(summary.jurisdictions).toContain('US');
      expect(summary.events).toHaveLength(1);
    });
  });

  describe('updateTaxCalculation', () => {
    test('should update tax calculation', async () => {
      const taxCalc = await TaxCalculation.createTaxCalculation({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        taxJurisdiction: 'US',
        taxYear: 2024,
        taxEventType: 'VESTING',
        taxEventDate: new Date('2024-01-01'),
        tokenAddress: testVault.token_address,
        tokenPriceUsd: '10.0',
        vestedAmount: '100',
        costBasisUsd: '0',
        fairMarketValueUsd: '1000',
        taxRatePercent: 20.0
      });

      const updated = await taxCalculationService.updateTaxCalculation(taxCalc.id, {
        userConfirmed: true,
        auto_withhold_enabled: true
      });

      expect(updated.user_confirmed).toBe(true);
      expect(updated.auto_withhold_enabled).toBe(true);
    });

    test('should throw error for non-existent tax calculation', async () => {
      await expect(taxCalculationService.updateTaxCalculation(
        'non-existent-id',
        { userConfirmed: true }
      )).rejects.toThrow('Tax calculation not found');
    });
  });

  describe('processTaxWithholding', () => {
    test('should process tax withholding', async () => {
      taxOracleService.getWithholdingRequirements.mockResolvedValue({
        provider: 'internal',
        data: {
          withholding_required: true,
          default_withholding_rate: 25.0
        }
      });

      taxCalculationService.getWithholdingEstimate.mockResolvedValue({
        totalTaxLiability: 200.0,
        totalWithheld: 0,
        remainingLiability: 200.0,
        recommendedWithholding: 220.0 // 10% buffer
      });

      const priceService = require('./priceService');
      priceService.getTokenPrice.mockResolvedValue('10.0');

      const result = await taxCalculationService.processTaxWithholding(
        testVault.id,
        '0xuseruseruseruseruseruseruseruseruseruser',
        '50'
      );

      expect(result.withholdingRequired).toBe(true);
      expect(result.withholdingAmount).toBe(220.0);
      expect(result.remainingClaimAmount).toBe(28); // 50 - (220/10)
      expect(result.jurisdiction).toBe('US');
    });

    test('should return no withholding for user without jurisdiction', async () => {
      taxCalculationService.getUserTaxProfile.mockResolvedValue({
        primaryJurisdiction: null
      });

      const result = await taxCalculationService.processTaxWithholding(
        testVault.id,
        '0xunknownuserunknownuserunknownuserunknown',
        '50'
      );

      expect(result.withholdingRequired).toBe(false);
      expect(result.withholdingAmount).toBe(0);
      expect(result.reason).toBe('No tax jurisdiction configured');
    });
  });

  describe('calculateSellToCover', () => {
    test('should calculate sell-to-cover tokens', () => {
      const tokensNeeded = taxCalculationService.calculateSellToCover(100, 10);
      expect(tokensNeeded).toBe(10.5); // 100 * 1.05 / 10
    });

    test('should handle zero token price', () => {
      const tokensNeeded = taxCalculationService.calculateSellToCover(100, 0);
      expect(tokensNeeded).toBe(0);
    });

    test('should use custom buffer', () => {
      const tokensNeeded = taxCalculationService.calculateSellToCover(100, 10, 10);
      expect(tokensNeeded).toBe(11); // 100 * 1.10 / 10
    });
  });

  describe('getTaxStatistics', () => {
    test('should get tax statistics', async () => {
      // Create multiple tax calculations
      await TaxCalculation.createTaxCalculation({
        vaultId: testVault.id,
        userAddress: '0xuser1user1user1user1user1user1user1',
        taxJurisdiction: 'US',
        taxYear: 2024,
        taxEventType: 'VESTING',
        taxEventDate: new Date('2024-01-01'),
        tokenAddress: testVault.token_address,
        tokenPriceUsd: '10.0',
        vestedAmount: '100',
        costBasisUsd: '0',
        fairMarketValueUsd: '1000',
        taxRatePercent: 20.0
      });

      await TaxCalculation.createTaxCalculation({
        vaultId: testVault.id,
        userAddress: '0xuser2user2user2user2user2user2user2',
        taxJurisdiction: 'UK',
        taxYear: 2024,
        taxEventType: 'CLAIM',
        taxEventDate: new Date('2024-06-01'),
        tokenAddress: testVault.token_address,
        tokenPriceUsd: '10.0',
        claimedAmount: '50',
        costBasisUsd: '0',
        fairMarketValueUsd: '500',
        taxRatePercent: 10.0
      });

      const stats = await taxCalculationService.getTaxStatistics();

      expect(stats.totalCalculations).toBe(2);
      expect(stats.totalTaxLiability).toBe(250.0); // 200 + 50
      expect(stats.jurisdictionBreakdown).toHaveLength(2);
      expect(stats.jurisdictionBreakdown.some(j => j.jurisdiction === 'US')).toBe(true);
      expect(stats.jurisdictionBreakdown.some(j => j.jurisdiction === 'UK')).toBe(true);
    });
  });

  describe('error handling', () => {
    test('should handle tax oracle service errors gracefully', async () => {
      taxOracleService.getTaxRates.mockRejectedValue(new Error('Oracle service unavailable'));

      const priceService = require('./priceService');
      priceService.getTokenPrice.mockResolvedValue('10.0');

      await expect(taxCalculationService.calculateVestingTax({
        vaultId: testVault.id,
        userAddress: '0xuseruseruseruseruseruseruseruseruseruser',
        jurisdiction: 'US',
        taxYear: 2024,
        vestingDate: new Date('2024-06-01'),
        tokenPrice: '10.0',
        vestedAmount: '100'
      })).rejects.toThrow('Oracle service unavailable');
    });
  });
});
