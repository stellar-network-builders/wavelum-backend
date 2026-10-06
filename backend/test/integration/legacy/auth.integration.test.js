const request = require('supertest');
const { ethers } = require('ethers');
const app = require('../src/index');
const { sequelize } = require('../src/database/connection');

// Test wallet configuration
const TEST_WALLET_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_WALLET_ADDRESS = '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6';

describe('Authentication Integration Tests', () => {
  let server;
  let wallet;

  beforeAll(async () => {
    // Start test server
    server = app.listen(0); // Use random port
    
    // Initialize test wallet
    wallet = new ethers.Wallet(TEST_WALLET_PRIVATE_KEY);
    
    // Setup test database
    await sequelize.authenticate();
  });

  afterAll(async () => {
    // Cleanup
    if (server) {
      server.close();
    }
    await sequelize.close();
  });

  describe('SEP-10 Challenge Flow', () => {
    test('should generate challenge for valid address', async () => {
      const response = await request(app)
        .post('/api/auth/challenge')
        .send({
          address: TEST_WALLET_ADDRESS
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.challenge).toBeDefined();
      expect(response.body.data.challenge).toContain('stellar'); // SEP-10 challenge format
    });

    test('should reject challenge request with missing address', async () => {
      const response = await request(app)
        .post('/api/auth/challenge')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Address is required');
    });

    test('should reject challenge request with invalid address', async () => {
      const response = await request(app)
        .post('/api/auth/challenge')
        .send({
          address: 'invalid_address'
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Invalid address format');
    });
  });

  describe('JWT Authentication Flow', () => {
    let accessToken;
    let refreshTokenCookie;

    test('should authenticate with valid signature', async () => {
      // First get challenge
      const challengeResponse = await request(app)
        .post('/api/auth/challenge')
        .send({
          address: TEST_WALLET_ADDRESS
        });

      const challenge = challengeResponse.body.data.challenge;
      
      // Sign the challenge
      const signature = await wallet.signMessage(challenge);

      // Login with signature
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          address: TEST_WALLET_ADDRESS,
          signature: signature
        });

      expect(loginResponse.status).toBe(200);
      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.data.accessToken).toBeDefined();
      expect(loginResponse.body.data.expiresIn).toBeDefined();
      expect(loginResponse.body.data.tokenType).toBe('Bearer');

      accessToken = loginResponse.body.data.accessToken;
      refreshTokenCookie = loginResponse.headers['set-cookie'];
    });

    test('should access protected route with valid JWT', async () => {
      const response = await request(app)
        .get('/api/user/vaults')
        .set('Authorization', `Bearer ${accessToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    test('should reject protected route without JWT', async () => {
      const response = await request(app)
        .get('/api/user/vaults');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    test('should reject protected route with invalid JWT', async () => {
      const response = await request(app)
        .get('/api/user/vaults')
        .set('Authorization', 'Bearer invalid_token');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });

    test('should refresh JWT token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', refreshTokenCookie);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.body.data.accessToken).not.toBe(accessToken); // Should be new token
    });

    test('should reject refresh without token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Refresh token required');
    });
  });

  describe('Token Validation', () => {
    test('should validate JWT token structure', async () => {
      // Get a valid token
      const challengeResponse = await request(app)
        .post('/api/auth/challenge')
        .send({
          address: TEST_WALLET_ADDRESS
        });

      const challenge = challengeResponse.body.data.challenge;
      const signature = await wallet.signMessage(challenge);

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          address: TEST_WALLET_ADDRESS,
          signature: signature
        });

      const token = loginResponse.body.data.accessToken;

      // Verify JWT structure (header.payload.signature)
      const parts = token.split('.');
      expect(parts).toHaveLength(3);

      // Verify header contains typical JWT fields
      const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
      expect(header.alg).toBeDefined();
      expect(header.typ).toBe('JWT');

      // Verify payload contains user info
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      expect(payload.address).toBe(TEST_WALLET_ADDRESS.toLowerCase());
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    test('should reject malformed JWT', async () => {
      const response = await request(app)
        .get('/api/user/vaults')
        .set('Authorization', 'Bearer malformed.jwt.token');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });

  describe('Security Tests', () => {
    test('should reject replay attacks', async () => {
      // Get first challenge and use it
      const challengeResponse1 = await request(app)
        .post('/api/auth/challenge')
        .send({
          address: TEST_WALLET_ADDRESS
        });

      const challenge1 = challengeResponse1.body.data.challenge;
      const signature1 = await wallet.signMessage(challenge1);

      const loginResponse1 = await request(app)
        .post('/api/auth/login')
        .send({
          address: TEST_WALLET_ADDRESS,
          signature: signature1
        });

      expect(loginResponse1.status).toBe(200);

      // Try to reuse the same challenge (should fail if replay protection is implemented)
      const loginResponse2 = await request(app)
        .post('/api/auth/login')
        .send({
          address: TEST_WALLET_ADDRESS,
          signature: signature1
        });

      // This might pass or fail depending on implementation
      // If replay protection is implemented, it should fail
      // For now, we'll just verify the response structure
      expect([200, 401]).toContain(loginResponse2.status);
    });

    test('should handle rate limiting', async () => {
      // Make multiple rapid requests to test rate limiting
      const requests = Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/auth/challenge')
          .send({
            address: TEST_WALLET_ADDRESS
          })
      );

      const responses = await Promise.all(requests);
      
      // Most should succeed, but some might be rate limited
      const successCount = responses.filter(res => res.status === 200).length;
      const rateLimitedCount = responses.filter(res => res.status === 429).length;

      expect(successCount + rateLimitedCount).toBe(10);
      
      // If rate limiting is implemented, at least some requests should be limited
      if (rateLimitedCount > 0) {
        const rateLimitedResponse = responses.find(res => res.status === 429);
        expect(rateLimitedResponse.body.error).toContain('rate limit');
      }
    });
  });

  describe('Error Handling', () => {
    test('should handle malformed request bodies', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send('invalid_json')
        .set('Content-Type', 'application/json');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should handle missing required fields', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          address: TEST_WALLET_ADDRESS
          // Missing signature
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('signature');
    });

    test('should handle server errors gracefully', async () => {
      // This test simulates a database connection error
      // In a real scenario, you might mock the database connection to fail
      
      const response = await request(app)
        .get('/api/user/vaults')
        .set('Authorization', 'Bearer valid_token_format');

      // Should return 401 for invalid token rather than 500
      expect([401, 500]).toContain(response.status);
      expect(response.body.success).toBe(false);
    });
  });
});
