const request = require('supertest');
const LegalAgreement = require('../models/LegalAgreement');
const Investor = require('../models/Investor');
const app = require('../index');

describe('Legal Agreements API', () => {
  let testInvestor;
  let testAgreement;
  let testLanguage;

  beforeAll(async () => {
    // Create test investor
    testInvestor = await Investor.create(
      '0x1234567890123456789012345678901234567890',
      'test@example.com',
      'Test Investor'
    );

    // Create test agreement
    testAgreement = await LegalAgreement.createAgreement(testInvestor.id, '1.0');

    // Get English language
    const languages = await LegalAgreement.getAvailableLanguages();
    testLanguage = languages.find(lang => lang.code === 'en');
  });

  afterAll(async () => {
    // Cleanup test data
    if (testInvestor) {
      await Investor.delete(testInvestor.id);
    }
  });

  describe('GET /api/legal/languages', () => {
    it('should return available languages', async () => {
      const response = await request(app)
        .get('/api/legal/languages')
        .expect(200);

      expect(response.body.languages).toBeDefined();
      expect(response.body.languages.length).toBeGreaterThan(0);
      expect(response.body.languages[0]).toHaveProperty('code');
      expect(response.body.languages[0]).toHaveProperty('name');
    });
  });

  describe('POST /api/legal/agreements', () => {
    it('should create a new agreement', async () => {
      const response = await request(app)
        .post('/api/legal/agreements')
        .send({
          walletAddress: '0x9876543210987654321098765432109876543210',
          email: 'newinvestor@example.com',
          name: 'New Investor'
        })
        .expect(201);

      expect(response.body.message).toBe('Agreement created successfully');
      expect(response.body.agreement).toHaveProperty('id');
      expect(response.body.investor).toHaveProperty('wallet_address');
    });

    it('should return error for missing wallet address', async () => {
      const response = await request(app)
        .post('/api/legal/agreements')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Wallet address is required');
    });
  });

  describe('POST /api/legal/agreements/:agreementId/hashes', () => {
    it('should add legal hash for agreement', async () => {
      const testContent = 'This is a test legal agreement content in English.';
      
      const response = await request(app)
        .post(`/api/legal/agreements/${testAgreement.id}/hashes`)
        .send({
          languageCode: 'en',
          content: testContent,
          isPrimary: false
        })
        .expect(200);

      expect(response.body.message).toBe('Legal hash updated successfully');
      expect(response.body.hash).toHaveProperty('sha256_hash');
      expect(response.body.hash.sha256_hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should return error for missing language code', async () => {
      const response = await request(app)
        .post(`/api/legal/agreements/${testAgreement.id}/hashes`)
        .send({
          content: 'Test content'
        })
        .expect(400);

      expect(response.body.error).toBe('Language code and content are required');
    });
  });

  describe('POST /api/legal/agreements/:agreementId/primary-language', () => {
    it('should set primary language with signing info', async () => {
      const response = await request(app)
        .post(`/api/legal/agreements/${testAgreement.id}/primary-language`)
        .send({
          languageCode: 'en',
          signerWallet: '0x1234567890123456789012345678901234567890',
          digitalSignature: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        })
        .expect(200);

      expect(response.body.message).toBe('Primary language set successfully');
      expect(response.body.primaryHash.is_primary).toBe(true);
      expect(response.body.primaryHash.signer_wallet_address).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should return error for invalid wallet format', async () => {
      const response = await request(app)
        .post(`/api/legal/agreements/${testAgreement.id}/primary-language`)
        .send({
          languageCode: 'en',
          signerWallet: 'invalid_wallet',
          digitalSignature: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
        })
        .expect(400);

      expect(response.body.error).toBe('Invalid signer wallet address format');
    });
  });

  describe('GET /api/legal/agreements/:agreementId/hashes', () => {
    it('should return all hashes for agreement', async () => {
      const response = await request(app)
        .get(`/api/legal/agreements/${testAgreement.id}/hashes`)
        .expect(200);

      expect(response.body.hashes).toBeDefined();
      expect(response.body.totalLanguages).toBeGreaterThan(0);
      expect(response.body.hasPrimary).toBe(true);
    });
  });

  describe('GET /api/legal/agreements/:agreementId/primary-hash', () => {
    it('should return primary hash for agreement', async () => {
      const response = await request(app)
        .get(`/api/legal/agreements/${testAgreement.id}/primary-hash`)
        .expect(200);

      expect(response.body.primaryHash).toBeDefined();
      expect(response.body.primaryHash.is_primary).toBe(true);
      expect(response.body.primaryHash.language_code).toBe('en');
    });
  });

  describe('POST /api/legal/agreements/:agreementId/verify', () => {
    it('should verify hash integrity', async () => {
      const testContent = 'This is a test legal agreement content in English.';
      
      const response = await request(app)
        .post(`/api/legal/agreements/${testAgreement.id}/verify`)
        .send({
          languageCode: 'en',
          content: testContent
        })
        .expect(200);

      expect(response.body.verification).toBeDefined();
      expect(response.body.verification.valid).toBe(true);
      expect(response.body.verification.storedHash).toBeDefined();
      expect(response.body.verification.calculatedHash).toBeDefined();
    });

    it('should detect content modification', async () => {
      const modifiedContent = 'This is a MODIFIED legal agreement content in English.';
      
      const response = await request(app)
        .post(`/api/legal/agreements/${testAgreement.id}/verify`)
        .send({
          languageCode: 'en',
          content: modifiedContent
        })
        .expect(200);

      expect(response.body.verification.valid).toBe(false);
      expect(response.body.verification.storedHash).not.toBe(response.body.verification.calculatedHash);
    });
  });

  describe('GET /api/legal/agreements/:agreementId/audit', () => {
    it('should return audit trail', async () => {
      const response = await request(app)
        .get(`/api/legal/agreements/${testAgreement.id}/audit`)
        .expect(200);

      expect(response.body.auditTrail).toBeDefined();
      expect(response.body.totalEntries).toBeGreaterThan(0);
    });
  });

  describe('GET /api/legal/investors/:walletAddress/agreements', () => {
    it('should return investor agreements', async () => {
      const response = await request(app)
        .get('/api/legal/investors/0x1234567890123456789012345678901234567890/agreements')
        .expect(200);

      expect(response.body.investor).toBeDefined();
      expect(response.body.agreements).toBeDefined();
      expect(response.body.totalAgreements).toBeGreaterThan(0);
    });

    it('should return 404 for non-existent investor', async () => {
      const response = await request(app)
        .get('/api/legal/investors/0x0000000000000000000000000000000000000000/agreements')
        .expect(404);

      expect(response.body.error).toBe('Investor not found');
    });

    it('should return error for invalid wallet format', async () => {
      const response = await request(app)
        .get('/api/legal/investors/invalid_wallet/agreements')
        .expect(400);

      expect(response.body.error).toBe('Invalid wallet address format');
    });
  });

  describe('GET /api/legal/agreements/:agreementId/legal-details', () => {
    it('should return comprehensive legal details', async () => {
      const response = await request(app)
        .get(`/api/legal/agreements/${testAgreement.id}/legal-details`)
        .expect(200);

      expect(response.body.legalStatus).toBeDefined();
      expect(response.body.legalStatus.totalLanguages).toBeGreaterThan(0);
      expect(response.body.legalStatus.hasPrimaryLanguage).toBe(true);
      expect(response.body.legalStatus.primaryLanguage).toBeDefined();
      expect(response.body.signingTimeline).toBeDefined();
      expect(response.body.auditTrail).toBeDefined();
    });
  });
});

describe('LegalAgreement Model', () => {
  describe('calculateHash', () => {
    it('should generate consistent SHA-256 hashes', () => {
      const content = 'Test content for hashing';
      const hash1 = LegalAgreement.calculateHash(content);
      const hash2 = LegalAgreement.calculateHash(content);
      
      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should generate different hashes for different content', () => {
      const content1 = 'Test content 1';
      const content2 = 'Test content 2';
      const hash1 = LegalAgreement.calculateHash(content1);
      const hash2 = LegalAgreement.calculateHash(content2);
      
      expect(hash1).not.toBe(hash2);
    });
  });
});
