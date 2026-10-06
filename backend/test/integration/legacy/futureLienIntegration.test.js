const request = require('supertest');
const { sequelize } = require('../src/database/connection');
const { Vault, Beneficiary, GrantStream, FutureLien, LienRelease, LienMilestone } = require('../src/models');
const futureLienService = require('../src/services/futureLienService');
const app = require('../src/index');

describe('Future Lien Integration Tests', () => {
  let testVault;
  let testBeneficiary;
  let testGrantStream;
  let authToken;
  let testUserAddress = '0x1234567890123456789012345678901234567890';

  beforeAll(async () => {
    // Setup test database
    await sequelize.sync({ force: true });
    
    // Create test vault
    testVault = await Vault.create({
      address: '0x9876543210987654321098765432109876543210',
      owner_address: testUserAddress,
      token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      total_amount: '1000',
      token_type: 'static'
    });

    // Create test beneficiary
    testBeneficiary = await Beneficiary.create({
      vault_id: testVault.id,
      address: testUserAddress,
      total_allocated: '500'
    });

    // Create test grant stream
    testGrantStream = await GrantStream.create({
      address: '0x1111111111111111111111111111111111111111',
      name: 'Test Grant Stream',
      description: 'A test grant stream for integration testing',
      owner_address: '0x2222222222222222222222222222222222222222',
      token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      target_amount: '10000',
      is_active: true
    });

    // Get auth token (mock authentication for testing)
    authToken = 'mock-jwt-token';
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Future Lien Creation', () => {
    test('should create a future lien with linear release', async () => {
      const lienData = {
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 100,
        release_start_date: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        release_end_date: new Date(Date.now() + 86400000 * 365).toISOString(), // 1 year from now
        release_rate_type: 'linear',
        transaction_hash: '0x' + 'a'.repeat(64)
      };

      const response = await request(app)
        .post('/api/future-liens')
        .set('Authorization', `Bearer ${authToken}`)
        .send(lienData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.lien).toBeDefined();
      expect(response.body.data.lien.committed_amount).toBe('100');
      expect(response.body.data.lien.release_rate_type).toBe('linear');
    });

    test('should create a future lien with milestone release', async () => {
      const lienData = {
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 200,
        release_start_date: new Date(Date.now() + 86400000).toISOString(),
        release_end_date: new Date(Date.now() + 86400000 * 365).toISOString(),
        release_rate_type: 'milestone',
        milestones: [
          {
            name: 'Milestone 1',
            description: 'First milestone',
            percentage_of_total: 50,
            target_date: new Date(Date.now() + 86400000 * 90).toISOString()
          },
          {
            name: 'Milestone 2',
            description: 'Second milestone',
            percentage_of_total: 50,
            target_date: new Date(Date.now() + 86400000 * 180).toISOString()
          }
        ],
        transaction_hash: '0x' + 'b'.repeat(64)
      };

      const response = await request(app)
        .post('/api/future-liens')
        .set('Authorization', `Bearer ${authToken}`)
        .send(lienData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.lien.milestones).toHaveLength(2);
      expect(response.body.data.lien.milestones[0].percentage_of_total).toBe('50');
    });

    test('should reject future lien with invalid vault address', async () => {
      const lienData = {
        vault_address: 'invalid-address',
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 100,
        release_start_date: new Date(Date.now() + 86400000).toISOString(),
        release_end_date: new Date(Date.now() + 86400000 * 365).toISOString(),
        release_rate_type: 'linear'
      };

      const response = await request(app)
        .post('/api/future-liens')
        .set('Authorization', `Bearer ${authToken}`)
        .send(lienData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });

    test('should reject future lien exceeding beneficiary allocation', async () => {
      const lienData = {
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 600, // Exceeds allocation of 500
        release_start_date: new Date(Date.now() + 86400000).toISOString(),
        release_end_date: new Date(Date.now() + 86400000 * 365).toISOString(),
        release_rate_type: 'linear'
      };

      const response = await request(app)
        .post('/api/future-liens')
        .set('Authorization', `Bearer ${authToken}`)
        .send(lienData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('exceeds beneficiary allocation');
    });
  });

  describe('Future Lien Retrieval', () => {
    let testLien;

    beforeAll(async () => {
      // Create a test lien for retrieval tests
      const result = await futureLienService.createFutureLien({
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 150,
        release_start_date: new Date(Date.now() + 86400000).toISOString(),
        release_end_date: new Date(Date.now() + 86400000 * 180).toISOString(),
        release_rate_type: 'linear'
      }, testUserAddress);
      
      testLien = result.lien;
    });

    test('should get liens for beneficiary', async () => {
      const response = await request(app)
        .get(`/api/future-liens/beneficiary/${testUserAddress}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    test('should get liens for vault', async () => {
      const response = await request(app)
        .get(`/api/future-liens/vault/${testVault.address}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
    });

    test('should get liens for grant stream', async () => {
      const response = await request(app)
        .get(`/api/future-liens/grant-stream/${testGrantStream.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
    });

    test('should get specific lien details', async () => {
      const response = await request(app)
        .get(`/api/future-liens/${testLien.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(testLien.id);
    });
  });

  describe('Lien Release Processing', () => {
    let testLien;

    beforeAll(async () => {
      // Create a test lien with immediate release for testing
      const result = await futureLienService.createFutureLien({
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 50,
        release_start_date: new Date(Date.now() - 86400000).toISOString(), // Yesterday
        release_end_date: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
        release_rate_type: 'immediate'
      }, testUserAddress);
      
      testLien = result.lien;
    });

    test('should process a lien release', async () => {
      const releaseData = {
        amount: 25,
        transaction_hash: '0x' + 'c'.repeat(64),
        block_number: 12345
      };

      const response = await request(app)
        .post(`/api/future-liens/${testLien.id}/release`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(releaseData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.release.amount).toBe('25');
      expect(response.body.data.lien.released_amount).toBe('25');
    });

    test('should reject release for non-existent lien', async () => {
      const releaseData = {
        amount: 10,
        transaction_hash: '0x' + 'd'.repeat(64)
      };

      const response = await request(app)
        .post('/api/future-liens/99999/release')
        .set('Authorization', `Bearer ${authToken}`)
        .send(releaseData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Lien Cancellation', () => {
    let testLien;

    beforeAll(async () => {
      // Create a test lien for cancellation
      const result = await futureLienService.createFutureLien({
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 75,
        release_start_date: new Date(Date.now() + 86400000).toISOString(),
        release_end_date: new Date(Date.now() + 86400000 * 90).toISOString(),
        release_rate_type: 'linear'
      }, testUserAddress);
      
      testLien = result.lien;
    });

    test('should cancel a future lien', async () => {
      const cancelData = {
        reason: 'Test cancellation'
      };

      const response = await request(app)
        .post(`/api/future-liens/${testLien.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .send(cancelData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.lien.status).toBe('cancelled');
    });

    test('should reject cancellation of completed lien', async () => {
      // First create and complete a lien
      const result = await futureLienService.createFutureLien({
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        grant_stream_id: testGrantStream.id,
        committed_amount: 25,
        release_start_date: new Date(Date.now() - 86400000).toISOString(),
        release_end_date: new Date(Date.now() + 86400000).toISOString(),
        release_rate_type: 'immediate'
      }, testUserAddress);

      // Process full release
      await futureLienService.processLienRelease({
        lien_id: result.lien.id,
        amount: 25
      }, testUserAddress);

      // Try to cancel
      const response = await request(app)
        .post(`/api/future-liens/${result.lien.id}/cancel`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reason: 'Should not work' })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Cannot cancel completed lien');
    });
  });

  describe('Grant Stream Management', () => {
    test('should create a new grant stream', async () => {
      const grantStreamData = {
        address: '0x3333333333333333333333333333333333333333',
        name: 'New Test Grant Stream',
        description: 'A new grant stream for testing',
        owner_address: '0x4444444444444444444444444444444444444444',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        target_amount: 5000,
        end_date: new Date(Date.now() + 86400000 * 365).toISOString()
      };

      const response = await request(app)
        .post('/api/grant-streams')
        .set('Authorization', `Bearer ${authToken}`)
        .send(grantStreamData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.grant_stream.name).toBe('New Test Grant Stream');
    });

    test('should get all active grant streams', async () => {
      const response = await request(app)
        .get('/api/grant-streams')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    test('should get specific grant stream details', async () => {
      const response = await request(app)
        .get(`/api/grant-streams/${testGrantStream.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.id).toBe(testGrantStream.id);
    });
  });

  describe('Lien Calculator', () => {
    test('should calculate lien impact', async () => {
      const params = {
        vault_address: testVault.address,
        beneficiary_address: testUserAddress,
        committed_amount: 100,
        release_rate_type: 'linear',
        release_start_date: new Date(Date.now() + 86400000).toISOString(),
        release_end_date: new Date(Date.now() + 86400000 * 180).toISOString()
      };

      const response = await request(app)
        .get('/api/vesting-to-grant/calculator')
        .set('Authorization', `Bearer ${authToken}`)
        .query(params)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.current_vesting).toBeDefined();
      expect(response.body.data.lien_projection).toBeDefined();
      expect(response.body.data.impact_analysis).toBeDefined();
    });

    test('should reject calculator with invalid parameters', async () => {
      const params = {
        vault_address: 'invalid-address',
        beneficiary_address: testUserAddress,
        committed_amount: 100,
        release_rate_type: 'linear',
        release_start_date: 'invalid-date',
        release_end_date: new Date(Date.now() + 86400000 * 180).toISOString()
      };

      const response = await request(app)
        .get('/api/vesting-to-grant/calculator')
        .set('Authorization', `Bearer ${authToken}`)
        .query(params)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Validation failed');
    });
  });

  describe('Active Lien Summary', () => {
    test('should get active lien summary', async () => {
      const response = await request(app)
        .get('/api/future-liens/summary')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      
      // Check that returned liens have calculated fields
      if (response.body.data.length > 0) {
        const lien = response.body.data[0];
        expect(lien.available_for_release).toBeDefined();
        expect(lien.remaining_amount).toBeDefined();
        expect(lien.is_within_release_period).toBeDefined();
      }
    });

    test('should filter summary by vault address', async () => {
      const response = await request(app)
        .get(`/api/future-liens/summary?vault_address=${testVault.address}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
    });
  });
});
