const request = require('supertest');

jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(),
    isOpen: true,
  })),
}));

jest.mock('../src/services/indexingService', () => ({
  initialize: jest.fn().mockResolvedValue(),
  initContract: jest.fn(),
  indexHistoricalBlocks: jest.fn(),
  listenToEvents: jest.fn(),
}));

const { sequelize } = require('../src/database/connection');
const app = require('../src/index');
const { Organization, Vault, VaultLegalDocument } = require('../src/models');

jest.setTimeout(60000);

describe('Legal Document Hashing API', () => {
  let adminToken;
  let outsiderToken;
  let vault;

  const samplePdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
  const alteredPdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n%%EOF');

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
    await sequelize.sync({ force: true });
  });

  beforeEach(async () => {
    await VaultLegalDocument.destroy({ where: {}, force: true });
    await Vault.destroy({ where: {}, force: true });
    await Organization.destroy({ where: {}, force: true });

    await Organization.create({
      name: 'Wave Labs',
      admin_address: '0xadmin000000000000000000000000000000000001',
    });

    vault = await Vault.create({
      address: '0xvault000000000000000000000000000000000001',
      name: 'Institutional Round',
      token_address: '0xtoken000000000000000000000000000000000001',
      owner_address: '0xowner000000000000000000000000000000000001',
      org_id: (await Organization.findOne()).id,
      total_amount: '5000000',
    });

    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({
        address: '0xadmin000000000000000000000000000000000001',
        signature: 'test-signature',
      })
      .expect(200);

    adminToken = adminLogin.body.data.accessToken;

    const outsiderLogin = await request(app)
      .post('/api/auth/login')
      .send({
        address: '0xoutsider000000000000000000000000000000001',
        signature: 'test-signature',
      })
      .expect(200);

    outsiderToken = outsiderLogin.body.data.accessToken;
  });

  test('stores a SHA-256 fingerprint for an uploaded legal PDF', async () => {
    const response = await request(app)
      .post(`/api/vaults/${vault.id}/legal-document`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/pdf')
      .set('x-document-name', 'token-purchase-agreement.pdf')
      .send(samplePdf)
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.vault_id).toBe(vault.id);
    expect(response.body.data.document_type).toBe('TOKEN_PURCHASE_AGREEMENT');
    expect(response.body.data.sha256_hash).toMatch(/^[a-f0-9]{64}$/);

    const storedRecord = await VaultLegalDocument.findOne({
      where: { vault_id: vault.id },
    });
    expect(storedRecord).not.toBeNull();
    expect(storedRecord.document_name).toBe('token-purchase-agreement.pdf');
  });

  test('verifies an uploaded document against the stored fingerprint', async () => {
    await request(app)
      .post(`/api/vaults/${vault.id}/legal-document`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/pdf')
      .set('x-document-name', 'executive-agreement.pdf')
      .send(samplePdf)
      .expect(201);

    const matchingVerification = await request(app)
      .post(`/api/vaults/${vault.id}/legal-document/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/pdf')
      .send(samplePdf)
      .expect(200);

    expect(matchingVerification.body.data.matches).toBe(true);

    const alteredVerification = await request(app)
      .post(`/api/vaults/${vault.id}/legal-document/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('Content-Type', 'application/pdf')
      .send(alteredPdf)
      .expect(200);

    expect(alteredVerification.body.data.matches).toBe(false);
    expect(alteredVerification.body.data.computedHash).not.toBe(alteredVerification.body.data.storedHash);
  });

  test('rejects unauthorized users from managing a vault legal document fingerprint', async () => {
    const response = await request(app)
      .post(`/api/vaults/${vault.id}/legal-document`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .set('Content-Type', 'application/pdf')
      .send(samplePdf)
      .expect(403);

    expect(response.body.success).toBe(false);
    expect(response.body.error).toContain('permission');
  });
});
