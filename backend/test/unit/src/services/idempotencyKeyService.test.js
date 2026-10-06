const { sequelize } = require('../database/connection');
const IdempotencyKeyService = require('./idempotencyKeyService');
const { IdempotencyKey } = require('../models');

describe('IdempotencyKeyService', () => {
  let service;

  beforeAll(async () => {
    // Sync database for testing
    await sequelize.sync({ force: true });
    service = IdempotencyKeyService;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await IdempotencyKey.destroy({ where: {} });
  });

  describe('generateIdempotencyKey', () => {
    it('should generate a consistent key for the same inputs', () => {
      const webhookType = 'claim';
      const targetEndpoint = 'https://example.com/webhook';
      const payload = { event: 'test', data: 'value' };

      const key1 = service.generateIdempotencyKey(webhookType, targetEndpoint, payload);
      const key2 = service.generateIdempotencyKey(webhookType, targetEndpoint, payload);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hash
    });

    it('should generate different keys for different inputs', () => {
      const webhookType = 'claim';
      const targetEndpoint = 'https://example.com/webhook';
      const payload1 = { event: 'test', data: 'value1' };
      const payload2 = { event: 'test', data: 'value2' };

      const key1 = service.generateIdempotencyKey(webhookType, targetEndpoint, payload1);
      const key2 = service.generateIdempotencyKey(webhookType, targetEndpoint, payload2);

      expect(key1).not.toBe(key2);
    });

    it('should use provided key when given', () => {
      const providedKey = 'custom-key-123';
      const webhookType = 'claim';
      const targetEndpoint = 'https://example.com/webhook';
      const payload = { event: 'test' };

      const key = service.generateIdempotencyKey(webhookType, targetEndpoint, payload, providedKey);

      expect(key).toBe(providedKey);
    });
  });

  describe('createPayloadHash', () => {
    it('should generate consistent hash for same payload regardless of key order', () => {
      const payload1 = { b: 2, a: 1 };
      const payload2 = { a: 1, b: 2 };

      const hash1 = service.createPayloadHash(payload1);
      const hash2 = service.createPayloadHash(payload2);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hash
    });
  });

  describe('checkIdempotencyKey', () => {
    it('should return null for non-existent key', async () => {
      const result = await service.checkIdempotencyKey('non-existent-key');
      expect(result).toBeNull();
    });

    it('should return null for expired key', async () => {
      const key = 'test-key';
      await service.createIdempotencyKey(key, 'claim', 'https://example.com', {}, -1); // Expired

      const result = await service.checkIdempotencyKey(key);
      expect(result).toBeNull();
    });

    it('should return record for valid existing key', async () => {
      const key = 'test-key';
      await service.createIdempotencyKey(key, 'claim', 'https://example.com', {});

      const result = await service.checkIdempotencyKey(key);
      expect(result).not.toBeNull();
      expect(result.key).toBe(key);
      expect(result.webhook_type).toBe('claim');
    });
  });

  describe('createIdempotencyKey', () => {
    it('should create new idempotency key record', async () => {
      const key = 'test-key';
      const webhookType = 'claim';
      const targetEndpoint = 'https://example.com/webhook';
      const payload = { event: 'test' };

      const record = await service.createIdempotencyKey(key, webhookType, targetEndpoint, payload);

      expect(record).not.toBeNull();
      expect(record.key).toBe(key);
      expect(record.webhook_type).toBe(webhookType);
      expect(record.target_endpoint).toBe(targetEndpoint);
      expect(record.status).toBe('pending');
      expect(record.payload_hash).toBe(service.createPayloadHash(payload));
    });

    it('should return existing record if key already exists', async () => {
      const key = 'test-key';
      const webhookType = 'claim';
      const targetEndpoint = 'https://example.com/webhook';
      const payload = { event: 'test' };

      const record1 = await service.createIdempotencyKey(key, webhookType, targetEndpoint, payload);
      const record2 = await service.createIdempotencyKey(key, webhookType, targetEndpoint, payload);

      expect(record1.id).toBe(record2.id);
      expect(record1.key).toBe(record2.key);
    });

    it('should throw error if key exists but payload differs', async () => {
      const key = 'test-key';
      const webhookType = 'claim';
      const targetEndpoint = 'https://example.com/webhook';
      const payload1 = { event: 'test1' };
      const payload2 = { event: 'test2' };

      await service.createIdempotencyKey(key, webhookType, targetEndpoint, payload1);

      await expect(
        service.createIdempotencyKey(key, webhookType, targetEndpoint, payload2)
      ).rejects.toThrow('Idempotency key exists but payload does not match');
    });
  });

  describe('markAsProcessing', () => {
    it('should update status to processing', async () => {
      const key = 'test-key';
      await service.createIdempotencyKey(key, 'claim', 'https://example.com', {});

      const result = await service.markAsProcessing(key);
      expect(result).toBe(true);

      const updated = await IdempotencyKey.findByPk(key);
      expect(updated.status).toBe('processing');
      expect(updated.last_attempt_at).not.toBeNull();
      expect(updated.attempt_count).toBe(1);
    });

    it('should return false for non-existent key', async () => {
      const result = await service.markAsProcessing('non-existent-key');
      expect(result).toBe(false);
    });
  });

  describe('markAsCompleted', () => {
    it('should update status to completed with response details', async () => {
      const key = 'test-key';
      await service.createIdempotencyKey(key, 'claim', 'https://example.com', {});

      const result = await service.markAsCompleted(key, 200, 'Success response');

      expect(result).toBe(true);

      const updated = await IdempotencyKey.findByPk(key);
      expect(updated.status).toBe('completed');
      expect(updated.response_status).toBe(200);
      expect(updated.response_body).toBe('Success response');
      expect(updated.last_attempt_at).not.toBeNull();
    });
  });

  describe('markAsFailed', () => {
    it('should update status to failed with error message', async () => {
      const key = 'test-key';
      await service.createIdempotencyKey(key, 'claim', 'https://example.com', {});

      const result = await service.markAsFailed(key, 'Network error');

      expect(result).toBe(true);

      const updated = await IdempotencyKey.findByPk(key);
      expect(updated.status).toBe('failed');
      expect(updated.error_message).toBe('Network error');
      expect(updated.last_attempt_at).not.toBeNull();
    });
  });

  describe('cleanupExpiredKeys', () => {
    it('should delete expired keys', async () => {
      const key1 = 'valid-key';
      const key2 = 'expired-key';

      await service.createIdempotencyKey(key1, 'claim', 'https://example.com', {});
      await service.createIdempotencyKey(key2, 'claim', 'https://example.com', {}, -1); // Expired

      const deletedCount = await service.cleanupExpiredKeys();
      expect(deletedCount).toBe(1);

      const validRecord = await IdempotencyKey.findByPk(key1);
      const expiredRecord = await IdempotencyKey.findByPk(key2);

      expect(validRecord).not.toBeNull();
      expect(expiredRecord).toBeNull();
    });
  });

  describe('getStatistics', () => {
    it('should return accurate statistics', async () => {
      // Create test records with different statuses
      await service.createIdempotencyKey('key1', 'claim', 'https://example.com', {});
      await service.createIdempotencyKey('key2', 'claim', 'https://example.com', {});
      await service.createIdempotencyKey('key3', 'claim', 'https://example.com', {}, -1); // Expired

      await service.markAsCompleted('key1');
      await service.markAsFailed('key2', 'Test error');

      const stats = await service.getStatistics();

      expect(stats.total).toBe(3);
      expect(stats.expired).toBe(1);
      expect(stats.byStatus.pending).toBe(0);
      expect(stats.byStatus.completed).toBe(1);
      expect(stats.byStatus.failed).toBe(1);
    });
  });

  describe('executeWithIdempotency', () => {
    it('should execute operation and cache result for first time', async () => {
      const mockOperation = jest.fn().mockResolvedValue({
        success: true,
        responseStatus: 200,
        responseBody: 'Operation successful',
      });

      const webhookType = 'claim';
      const targetEndpoint = 'https://example.com/webhook';
      const payload = { event: 'test' };

      const result = await service.executeWithIdempotency(
        webhookType,
        targetEndpoint,
        payload,
        mockOperation
      );

      expect(result.success).toBe(true);
      expect(result.fromCache).toBe(false);
      expect(mockOperation).toHaveBeenCalledTimes(1);

      // Check that idempotency record was created and marked as completed
      const record = await service.checkIdempotencyKey(
        service.generateIdempotencyKey(webhookType, targetEndpoint, payload)
      );
      expect(record.status).toBe('completed');
    });

    it('should return cached result for subsequent calls', async () => {
      const mockOperation = jest.fn().mockResolvedValue({
        success: true,
        responseStatus: 200,
        responseBody: 'Operation successful',
      });

      const webhookType = 'claim';
      const targetEndpoint = 'https://example.com/webhook';
      const payload = { event: 'test' };

      // First call
      const result1 = await service.executeWithIdempotency(
        webhookType,
        targetEndpoint,
        payload,
        mockOperation
      );

      // Second call
      const result2 = await service.executeWithIdempotency(
        webhookType,
        targetEndpoint,
        payload,
        mockOperation
      );

      expect(result1.success).toBe(true);
      expect(result1.fromCache).toBe(false);

      expect(result2.success).toBe(true);
      expect(result2.fromCache).toBe(true);
      expect(result2.responseStatus).toBe(200);
      expect(result2.responseBody).toBe('Operation successful');

      // Operation should only be called once
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should handle operation failure and mark as failed', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Operation failed'));

      const webhookType = 'claim';
      const targetEndpoint = 'https://example.com/webhook';
      const payload = { event: 'test' };

      await expect(
        service.executeWithIdempotency(webhookType, targetEndpoint, payload, mockOperation)
      ).rejects.toThrow('Operation failed');

      // Check that idempotency record was marked as failed
      const record = await service.checkIdempotencyKey(
        service.generateIdempotencyKey(webhookType, targetEndpoint, payload)
      );
      expect(record.status).toBe('failed');
      expect(record.error_message).toBe('Operation failed');
    });

    it('should return cached failure for subsequent calls after failure', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Operation failed'));

      const webhookType = 'claim';
      const targetEndpoint = 'https://example.com/webhook';
      const payload = { event: 'test' };

      // First call - should fail
      try {
        await service.executeWithIdempotency(webhookType, targetEndpoint, payload, mockOperation);
      } catch (error) {
        // Expected to fail
      }

      // Second call - should return cached failure
      const result = await service.executeWithIdempotency(
        webhookType,
        targetEndpoint,
        payload,
        mockOperation
      );

      expect(result.success).toBe(false);
      expect(result.fromCache).toBe(true);
      expect(result.status).toBe('failed');
      expect(result.error).toBe('Operation failed');

      // Operation should only be called once
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });
  });
});
