/**
 * Test suite for Privacy Masking functionality
 * Tests zero-knowledge privacy metadata masking for vault tokens
 */

const { 
  PRIVACY_TIERS, 
  maskTokenAmount, 
  getPrivacyTier, 
  hasUnmaskedPermission, 
  applyPrivacyMasking 
} = require('../src/utils/privacyMasking');

describe('Privacy Masking Tests', () => {
  
  describe('PRIVACY_TIERS', () => {
    test('should have correct tier definitions', () => {
      expect(PRIVACY_TIERS.TINY).toEqual({ min: 0, max: 1000, label: 'Under 1k' });
      expect(PRIVACY_TIERS.SMALL).toEqual({ min: 1000, max: 10000, label: 'Between 1k and 10k' });
      expect(PRIVACY_TIERS.MEDIUM).toEqual({ min: 10000, max: 50000, label: 'Between 10k and 50k' });
      expect(PRIVACY_TIERS.LARGE).toEqual({ min: 50000, max: 100000, label: 'Between 50k and 100k' });
      expect(PRIVACY_TIERS.XLARGE).toEqual({ min: 100000, max: 500000, label: 'Between 100k and 500k' });
      expect(PRIVACY_TIERS.HUGE).toEqual({ min: 500000, max: 1000000, label: 'Between 500k and 1M' });
      expect(PRIVACY_TIERS.MASSIVE).toEqual({ min: 1000000, max: Infinity, label: 'Over 1M' });
    });
  });

  describe('maskTokenAmount', () => {
    test('should mask tiny amounts correctly', () => {
      const result = maskTokenAmount(500);
      expect(result).toEqual({
        is_masked: true,
        amount: 500,
        display_amount: 'Under 1k',
        tier: 'Under 1k',
        range: { min: 0, max: 1000 }
      });
    });

    test('should mask small amounts correctly', () => {
      const result = maskTokenAmount(5000);
      expect(result).toEqual({
        is_masked: true,
        amount: 5000,
        display_amount: 'Between 1k and 10k',
        tier: 'Between 1k and 10k',
        range: { min: 1000, max: 10000 }
      });
    });

    test('should mask medium amounts correctly', () => {
      const result = maskTokenAmount(25000);
      expect(result).toEqual({
        is_masked: true,
        amount: 25000,
        display_amount: 'Between 10k and 50k',
        tier: 'Between 10k and 50k',
        range: { min: 10000, max: 50000 }
      });
    });

    test('should handle edge cases correctly', () => {
      // Exact boundary values
      expect(maskTokenAmount(1000).tier).toBe('Between 1k and 10k');
      expect(maskTokenAmount(10000).tier).toBe('Between 10k and 50k');
      expect(maskTokenAmount(50000).tier).toBe('Between 50k and 100k');
      
      // Massive amounts
      const massive = maskTokenAmount(2000000);
      expect(massive.tier).toBe('Over 1M');
      expect(massive.range.max).toBeNull();
    });

    test('should handle invalid inputs', () => {
      expect(maskTokenAmount(0)).toEqual({
        is_masked: false,
        amount: 0,
        display_amount: '0',
        tier: null
      });

      expect(maskTokenAmount(-100)).toEqual({
        is_masked: false,
        amount: -100,
        display_amount: '0',
        tier: null
      });

      expect(maskTokenAmount('invalid')).toEqual({
        is_masked: false,
        amount: NaN,
        display_amount: '0',
        tier: null
      });
    });
  });

  describe('getPrivacyTier', () => {
    test('should return correct tier for various amounts', () => {
      expect(getPrivacyTier(500)).toBe('Under 1k');
      expect(getPrivacyTier(5000)).toBe('Between 1k and 10k');
      expect(getPrivacyTier(25000)).toBe('Between 10k and 50k');
      expect(getPrivacyTier(75000)).toBe('Between 50k and 100k');
      expect(getPrivacyTier(250000)).toBe('Between 100k and 500k');
      expect(getPrivacyTier(750000)).toBe('Between 500k and 1M');
      expect(getPrivacyTier(2000000)).toBe('Over 1M');
    });

    test('should return null for invalid inputs', () => {
      expect(getPrivacyTier(0)).toBeNull();
      expect(getPrivacyTier(-100)).toBeNull();
      expect(getPrivacyTier('invalid')).toBeNull();
    });
  });

  describe('hasUnmaskedPermission', () => {
    const mockVault = {
      owner_address: '0xOWNER123',
      beneficiaries: [
        { address: '0xBENEFICIARY1' },
        { address: '0xBENEFICIARY2' }
      ]
    };

    test('should grant permission to admin users', () => {
      const adminUser = { address: '0xADMIN123', role: 'admin' };
      expect(hasUnmaskedPermission(adminUser, mockVault)).toBe(true);
    });

    test('should grant permission to vault owner', () => {
      const ownerUser = { address: '0xOWNER123' };
      expect(hasUnmaskedPermission(ownerUser, mockVault)).toBe(true);
    });

    test('should grant permission to beneficiaries', () => {
      const beneficiaryUser = { address: '0xBENEFICIARY1' };
      expect(hasUnmaskedPermission(beneficiaryUser, mockVault)).toBe(true);
    });

    test('should deny permission to unauthorized users', () => {
      const unauthorizedUser = { address: '0xUNAUTHORIZED' };
      expect(hasUnmaskedPermission(unauthorizedUser, mockVault)).toBe(false);
    });

    test('should handle missing data gracefully', () => {
      expect(hasUnmaskedPermission(null, mockVault)).toBe(false);
      expect(hasUnmaskedPermission({}, null)).toBe(false);
      expect(hasUnmaskedPermission(null, null)).toBe(false);
    });
  });

  describe('applyPrivacyMasking', () => {
    const mockVaultWithPrivacy = {
      id: 'vault-123',
      owner_address: '0xOWNER123',
      total_amount: 25000,
      privacy_mode_enabled: true,
      beneficiaries: [
        { 
          address: '0xBENEFICIARY1', 
          total_allocated: 15000,
          total_withdrawn: 5000
        }
      ]
    };

    const mockVaultWithoutPrivacy = {
      id: 'vault-456',
      owner_address: '0xOWNER123',
      total_amount: 25000,
      privacy_mode_enabled: false
    };

    test('should not apply masking when privacy mode is disabled', () => {
      const user = { address: '0xUNAUTHORIZED' };
      const result = applyPrivacyMasking(mockVaultWithoutPrivacy, user);
      expect(result).toEqual(mockVaultWithoutPrivacy);
    });

    test('should not apply masking for authorized users', () => {
      const ownerUser = { address: '0xOWNER123' };
      const result = applyPrivacyMasking(mockVaultWithPrivacy, ownerUser);
      
      expect(result.privacy_mode_enabled).toBe(true);
      expect(result.data_masked).toBe(false);
      expect(result.total_amount).toBe(25000); // Should remain unmasked
    });

    test('should apply masking for unauthorized users', () => {
      const unauthorizedUser = { address: '0xUNAUTHORIZED' };
      const result = applyPrivacyMasking(mockVaultWithPrivacy, unauthorizedUser);
      
      expect(result.privacy_mode_enabled).toBe(true);
      expect(result.data_masked).toBe(true);
      expect(result.total_amount).toEqual({
        is_masked: true,
        amount: 25000,
        display_amount: 'Between 10k and 50k',
        tier: 'Between 10k and 50k',
        range: { min: 10000, max: 50000 }
      });
    });

    test('should handle VaultRegistry format', () => {
      const mockRegistryEntry = {
        contract_id: 'contract-123',
        project_name: 'Test Project',
        vaultDetails: mockVaultWithPrivacy
      };

      const unauthorizedUser = { address: '0xUNAUTHORIZED' };
      const result = applyPrivacyMasking(mockRegistryEntry, unauthorizedUser);
      
      expect(result.contract_id).toBe('contract-123');
      expect(result.vaultDetails.privacy_mode_enabled).toBe(true);
      expect(result.vaultDetails.data_masked).toBe(true);
      expect(result.vaultDetails.total_amount).toEqual({
        is_masked: true,
        amount: 25000,
        display_amount: 'Between 10k and 50k',
        tier: 'Between 10k and 50k',
        range: { min: 10000, max: 50000 }
      });
    });

    test('should handle missing data gracefully', () => {
      expect(applyPrivacyMasking(null, {})).toBeNull();
      expect(applyPrivacyMasking(undefined, {})).toBeUndefined();
    });
  });
});

// Integration test example
describe('Privacy Masking Integration', () => {
  test('should work end-to-end with realistic vault data', () => {
    const realisticVault = {
      id: 'vault-realistic-123',
      address: '0xVAULT123',
      owner_address: '0xOWNER123',
      total_amount: 125000, // Large amount
      privacy_mode_enabled: true,
      beneficiaries: [
        {
          address: '0xBENEFICIARY1',
          email: 'beneficiary1@example.com',
          total_allocated: 75000,
          total_withdrawn: 25000
        },
        {
          address: '0xBENEFICIARY2',
          email: 'beneficiary2@example.com',
          total_allocated: 50000,
          total_withdrawn: 10000
        }
      ],
      subSchedules: [
        {
          id: 'schedule-1',
          top_up_amount: 100000,
          amount_withdrawn: 35000
        }
      ]
    };

    // Test unauthorized access
    const unauthorizedUser = { address: '0xUNAUTHORIZED' };
    const maskedResult = applyPrivacyMasking(realisticVault, unauthorizedUser);

    expect(maskedResult.data_masked).toBe(true);
    expect(maskedResult.total_amount.display_amount).toBe('Between 100k and 500k');
    
    // Check beneficiary masking
    maskedResult.beneficiaries.forEach(beneficiary => {
      expect(beneficiary.total_allocated.is_masked).toBe(true);
      expect(beneficiary.total_withdrawn.is_masked).toBe(true);
    });

    // Check schedule masking
    maskedResult.subSchedules.forEach(schedule => {
      expect(schedule.top_up_amount.is_masked).toBe(true);
      expect(schedule.amount_withdrawn.is_masked).toBe(true);
    });

    // Test authorized access
    const ownerUser = { address: '0xOWNER123' };
    const unmaskedResult = applyPrivacyMasking(realisticVault, ownerUser);

    expect(unmaskedResult.data_masked).toBe(false);
    expect(unmaskedResult.total_amount).toBe(125000);
    
    // Beneficiary data should remain unmasked for owner
    unmaskedResult.beneficiaries.forEach(beneficiary => {
      expect(typeof beneficiary.total_allocated).toBe('number');
      expect(typeof beneficiary.total_withdrawn).toBe('number');
    });
  });
});
