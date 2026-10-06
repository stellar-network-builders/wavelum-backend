// backend/tests/kyc_risk_tests.js
const service = require('../src/services/kyc_risk_service');

describe('KYC Risk Evaluation', () => {
  it('auto-approves low-tier with basic checks passed', async () => {
    const result = await service.evaluateKyc('profile1', 500, true);
    expect(result.status).toBe('ACCEPTED');
  });

  it('flags high-tier for manual review', async () => {
    const result = await service.evaluateKyc('profile2', 2000, true);
    expect(result.status).toBe('PENDING_REVIEW');
  });

  it('rejects if basic checks fail', async () => {
    const result = await service.evaluateKyc('profile3', 500, false);
    expect(result.status).toBe('REVIEW');
  });
});
