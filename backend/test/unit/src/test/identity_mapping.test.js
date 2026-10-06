// backend/tests/identity_mapping_tests.js
const service = require('../src/services/identity_service');

describe('Identity Mapping', () => {
  it('should reject linking if profile not verified', async () => {
    await expect(service.linkKey('unverified-profile', 'GABC123...', {}))
      .rejects.toThrow('Profile not verified');
  });

  it('should link multiple keys to one profile', async () => {
    const result1 = await service.linkKey('verified-profile', 'GABC123...', {});
    const result2 = await service.linkKey('verified-profile', 'GXYZ789...', {});
    expect(result1.publicKey).toBe('GABC123...');
    expect(result2.publicKey).toBe('GXYZ789...');
  });

  it('should fetch keys for a profile', async () => {
    const keys = await service.getKeys('verified-profile');
    expect(keys.length).toBeGreaterThan(0);
  });

  it('should fetch profile for a key', async () => {
    const profile = await service.getProfile('GABC123...');
    expect(profile.verification_status).toBe('verified');
  });
});
