'use strict';

const request = require('supertest');
const app = require('../src/index');

describe('Account Consolidation API Integration Tests', () => {
  describe('GET /api/user/:address/consolidated', () => {
    it('should return consolidated view for beneficiary', async () => {
      const response = await request(app)
        .get('/api/user/0x1234567890123456789012345678901234567890/consolidated')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('beneficiary_address');
      expect(response.body.data).toHaveProperty('total_vaults');
      expect(response.body.data).toHaveProperty('total_allocated');
      expect(response.body.data).toHaveProperty('total_withdrawn');
      expect(response.body.data).toHaveProperty('total_withdrawable');
      expect(response.body.data).toHaveProperty('vaults');
      expect(response.body.data).toHaveProperty('consolidation_summary');
    });

    it('should handle query parameters correctly', async () => {
      const response = await request(app)
        .get('/api/user/0x1234567890123456789012345678901234567890/consolidated')
        .query({
          organizationId: 'test-org',
          tokenAddress: '0xabcdef',
          asOfDate: '2024-01-01T00:00:00.000Z'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.beneficiary_address).toBe('0x1234567890123456789012345678901234567890');
    });

    it('should return empty result for unknown beneficiary', async () => {
      const response = await request(app)
        .get('/api/user/0xunknownaddress/consolidated')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.total_vaults).toBe(0);
      expect(response.body.data.total_allocated).toBe('0');
      expect(response.body.data.vaults).toHaveLength(0);
    });
  });

  describe('POST /api/admin/consolidate-accounts', () => {
    it('should require authentication for account consolidation', async () => {
      const response = await request(app)
        .post('/api/admin/consolidate-accounts')
        .send({
          primaryAddress: '0x1234567890123456789012345678901234567890',
          addressesToMerge: ['0xabcdef1234567890123456789012345678901234'],
          adminAddress: '0xadmin123456789012345678901234567890123456'
        })
        .expect(500); // Should fail due to missing authentication/authorization

      expect(response.body.success).toBe(false);
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/api/admin/consolidate-accounts')
        .send({})
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('required');
    });

    it('should validate addressesToMerge is array', async () => {
      const response = await request(app)
        .post('/api/admin/consolidate-accounts')
        .send({
          primaryAddress: '0x1234567890123456789012345678901234567890',
          addressesToMerge: 'not-an-array',
          adminAddress: '0xadmin123456789012345678901234567890123456'
        })
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('non-empty array');
    });
  });
});
