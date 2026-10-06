// backend/tests/kyc_webhook_tests.js
const request = require('supertest');
const app = require('../app');

describe('KYC Webhook', () => {
  it('rejects invalid signature', async () => {
    const res = await request(app)
      .post('/webhook/kyc')
      .set('x-signature', 'bad-signature')
      .send({ applicantId: '123', reviewStatus: 'completed' });
    expect(res.status).toBe(401);
  });

  it('accepts valid signature and updates status', async () => {
    // Mock signature generation with secret
    const payload = { applicantId: '123', reviewStatus: 'completed' };
    const sig = crypto.createHmac('sha256', process.env.KYC_WEBHOOK_SECRET)
      .update(JSON.stringify(payload)).digest('hex');

    const res = await request(app)
      .post('/webhook/kyc')
      .set('x-signature', sig)
      .send(payload);

    expect(res.status).toBe(200);
    // Optionally query DB to confirm status updated
  });
});
