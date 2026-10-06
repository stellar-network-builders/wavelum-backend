const request = require('supertest');
const express = require('express');
const sep10Auth = require('../middleware/sep10Auth.middleware');

describe('SEP-10 Authentication Middleware', () => {
  let app;
  
  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Test route with SEP-10 authentication
    app.get('/protected', sep10Auth.authenticate(), (req, res) => {
      res.json({
        success: true,
        user: req.sep10User
      });
    });
    
    // Test route with SEP-10 admin authentication
    app.get('/admin', sep10Auth.authenticateAdmin(), (req, res) => {
      res.json({
        success: true,
        user: req.sep10User
      });
    });
  });

  describe('Authentication Required', () => {
    it('should return 401 when no token provided', async () => {
      const response = await request(app)
        .get('/protected')
        .expect(401);
      
      expect(response.body).toMatchObject({
        success: false,
        error: 'authentication_required',
        message: 'SEP-10 JWT token required in Authorization header'
      });
    });

    it('should return 401 when invalid token format', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'Invalid token')
        .expect(401);
      
      expect(response.body).toMatchObject({
        success: false,
        error: 'authentication_required'
      });
    });
  });

  describe('Token Validation', () => {
    // Note: These tests would require actual SEP-10 JWT tokens
    // In a real implementation, you would generate test tokens using stellar-sdk
    
    it('should validate SEP-10 claims structure', () => {
      const middleware = sep10Auth;
      
      // Test valid Stellar public key
      expect(middleware.isValidStellarPublicKey('GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567')).toBe(true);
      
      // Test invalid Stellar public keys
      expect(middleware.isValidStellarPublicKey('invalid')).toBe(false);
      expect(middleware.isValidStellarPublicKey('G123')).toBe(false);
      expect(middleware.isValidStellarPublicKey('XABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567')).toBe(false);
    });

    it('should validate SEP-10 JWT claims', () => {
      const middleware = sep10Auth;
      
      // Test valid claims
      const validClaims = {
        iss: 'https://anchor.example.com',
        sub: 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567',
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        iat: Math.floor(Date.now() / 1000) // now
      };
      
      const result = middleware.validateSEP10Claims(validClaims);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.stellarPublicKey).toBe(validClaims.sub);
      
      // Test missing claims
      const missingClaims = { sub: 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567' };
      const missingResult = middleware.validateSEP10Claims(missingClaims);
      expect(missingResult.isValid).toBe(false);
      expect(missingResult.errors.length).toBeGreaterThan(0);
      
      // Test invalid sub claim
      const invalidSub = {
        iss: 'https://anchor.example.com',
        sub: 'invalid',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      };
      const invalidSubResult = middleware.validateSEP10Claims(invalidSub);
      expect(invalidSubResult.isValid).toBe(false);
      expect(invalidSubResult.errors).toContain('Invalid "sub" claim - must be a valid Stellar public key');
      
      // Test expired token
      const expiredClaims = {
        iss: 'https://anchor.example.com',
        sub: 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567',
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
        iat: Math.floor(Date.now() / 1000) - 7200 // 2 hours ago
      };
      const expiredResult = middleware.validateSEP10Claims(expiredClaims);
      expect(expiredResult.isValid).toBe(false);
      expect(expiredResult.errors).toContain('Token has expired');
    });

    it('should check user authorization correctly', () => {
      const middleware = sep10Auth;
      const userPublicKey = 'GABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz234567';
      
      // Test authorized access (same user)
      const authorizedReq = {
        params: { userAddress: userPublicKey }
      };
      expect(middleware.isUserAuthorized(userPublicKey, authorizedReq)).toBe(true);
      
      // Test unauthorized access (different user)
      const unauthorizedReq = {
        params: { userAddress: 'GBCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz123456' }
      };
      expect(middleware.isUserAuthorized(userPublicKey, unauthorizedReq)).toBe(false);
      
      // Test no specific user requested (should allow)
      const noUserReq = {
        params: {},
        query: {},
        body: {}
      };
      expect(middleware.isUserAuthorized(userPublicKey, noUserReq)).toBe(true);
    });
  });

  describe('Configuration', () => {
    it('should handle missing server public key', async () => {
      // Temporarily unset the environment variable
      const originalKey = process.env.STELLAR_SERVER_PUBLIC_KEY;
      delete process.env.STELLAR_SERVER_PUBLIC_KEY;
      
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer some-token')
        .expect(500);
      
      expect(response.body).toMatchObject({
        success: false,
        error: 'server_configuration_error',
        message: 'Server public key not configured'
      });
      
      // Restore the environment variable
      if (originalKey) {
        process.env.STELLAR_SERVER_PUBLIC_KEY = originalKey;
      }
    });
  });
});
