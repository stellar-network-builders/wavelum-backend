const axios = require('axios');
const nock = require('nock');
const { sequelize } = require('../database/connection');
const idempotencyKeyService = require('./idempotencyKeyService');
const claimWebhookDispatcherService = require('./claimWebhookDispatcherService');
const slackWebhookService = require('./slackWebhookService');
const { IdempotencyKey, OrganizationWebhook, ClaimWebhookDelivery } = require('../models');

describe('IdempotencyKey Integration Tests', () => {
  beforeAll(async () => {
    // Sync database for testing
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await IdempotencyKey.destroy({ where: {} });
    await OrganizationWebhook.destroy({ where: {} });
    await ClaimWebhookDelivery.destroy({ where: {} });
    nock.cleanAll();
  });

  describe('Claim Webhook Idempotency', () => {
    it('should prevent duplicate claim webhook deliveries', async () => {
      const webhookUrl = 'https://example.com/claim-webhook';
      const claimEvent = {
        event_id: 'test-claim-123',
        beneficiary_address: '0x1234567890123456789012345678901234567890',
        amount: '1000',
        transaction_hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        block_number: 12345,
        token_address: '0x1234567890123456789012345678901234567890',
        organization_id: 'org-123',
      };

      // Mock the webhook endpoint
      const scope = nock(webhookUrl)
        .post('/')
        .reply(200, { success: true });

      // Create organization webhook
      await OrganizationWebhook.create({
        organization_id: 'org-123',
        webhook_url: webhookUrl,
      });

      // First delivery
      const result1 = await claimWebhookDispatcherService.enqueueTokensClaimedEvent(claimEvent);
      expect(result1.queued).toBe(1);

      // Wait a bit for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second delivery (should be skipped due to idempotency)
      const result2 = await claimWebhookDispatcherService.enqueueTokensClaimedEvent(claimEvent);
      expect(result2.queued).toBe(0);

      // Verify only one webhook was actually sent
      expect(scope.isDone()).toBe(true);

      // Check idempotency record
      const idempotencyRecords = await IdempotencyKey.findAll({
        where: { webhook_type: 'claim' },
      });
      expect(idempotencyRecords).toHaveLength(1);
      expect(idempotencyRecords[0].status).toBe('completed');
    });

    it('should handle webhook failure and retry with idempotency', async () => {
      const webhookUrl = 'https://example.com/claim-webhook';
      const claimEvent = {
        event_id: 'test-claim-456',
        beneficiary_address: '0x1234567890123456789012345678901234567890',
        amount: '1000',
        transaction_hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        block_number: 12345,
        token_address: '0x1234567890123456789012345678901234567890',
        organization_id: 'org-123',
      };

      // Mock the webhook endpoint to fail first, then succeed
      const scope = nock(webhookUrl)
        .post('/')
        .reply(500, { error: 'Internal server error' })
        .post('/')
        .reply(200, { success: true });

      // Create organization webhook
      await OrganizationWebhook.create({
        organization_id: 'org-123',
        webhook_url: webhookUrl,
      });

      // First delivery (should fail)
      const result1 = await claimWebhookDispatcherService.enqueueTokensClaimedEvent(claimEvent);
      expect(result1.queued).toBe(1);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check idempotency record should be marked as failed
      const idempotencyRecords = await IdempotencyKey.findAll({
        where: { webhook_type: 'claim' },
      });
      expect(idempotencyRecords).toHaveLength(1);
      expect(idempotencyRecords[0].status).toBe('failed');

      // Second delivery (should use cached failure)
      const result2 = await claimWebhookDispatcherService.enqueueTokensClaimedEvent(claimEvent);
      expect(result2.queued).toBe(0);
    });
  });

  describe('Slack Webhook Idempotency', () => {
    beforeEach(() => {
      process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.com/services/test/webhook';
    });

    afterEach(() => {
      delete process.env.SLACK_WEBHOOK_URL;
    });

    it('should prevent duplicate Slack notifications', async () => {
      const claimData = {
        user_address: '0x1234567890123456789012345678901234567890',
        token_address: '0x1234567890123456789012345678901234567890',
        amount_claimed: '1000000', // $10,000 worth at $0.01 per token
        transaction_hash: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
        block_number: 12345,
        price_at_claim_usd: '0.01',
      };

      // Mock Slack webhook
      const scope = nock('https://hooks.slack.com')
        .post('/services/test/webhook')
        .reply(200, 'ok');

      // First alert
      const result1 = await slackWebhookService.sendLargeClaimAlert(claimData, 10000);
      expect(result1).toBe(true);

      // Second alert (should be skipped due to idempotency)
      const result2 = await slackWebhookService.sendLargeClaimAlert(claimData, 10000);
      expect(result2).toBe(true);

      // Verify only one webhook was actually sent
      expect(scope.isDone()).toBe(true);

      // Check idempotency record
      const idempotencyRecords = await IdempotencyKey.findAll({
        where: { webhook_type: 'slack' },
      });
      expect(idempotencyRecords).toHaveLength(1);
      expect(idempotencyRecords[0].status).toBe('completed');
    });
  });

  describe('Email Service Idempotency', () => {
    beforeEach(() => {
      process.env.EMAIL_HOST = 'localhost';
      process.env.EMAIL_PORT = '587';
      process.env.EMAIL_USER = 'test@example.com';
      process.env.EMAIL_PASS = 'test-password';
    });

    afterEach(() => {
      delete process.env.EMAIL_HOST;
      delete process.env.EMAIL_PORT;
      delete process.env.EMAIL_USER;
      delete process.env.EMAIL_PASS;
    });

    it('should prevent duplicate emails', async () => {
      const emailService = require('./emailService');
      const to = 'user@example.com';
      const subject = 'Test Subject';
      const text = 'Test email content';
      const html = '<p>Test email content</p>';

      // Mock nodemailer
      const mockSendMail = jest.fn().mockResolvedValue({
        messageId: 'test-message-id',
      });

      emailService.transporter.sendMail = mockSendMail;

      // First email
      const result1 = await emailService.sendEmail(to, subject, text, html);
      expect(result1).toBe(true);

      // Second email (should be skipped due to idempotency)
      const result2 = await emailService.sendEmail(to, subject, text, html);
      expect(result2).toBe(true);

      // Verify only one email was actually sent
      expect(mockSendMail).toHaveBeenCalledTimes(1);

      // Check idempotency record
      const idempotencyRecords = await IdempotencyKey.findAll({
        where: { webhook_type: 'email' },
      });
      expect(idempotencyRecords).toHaveLength(1);
      expect(idempotencyRecords[0].status).toBe('completed');
    });
  });

  describe('Cleanup Functionality', () => {
    it('should clean up expired idempotency keys', async () => {
      // Create some test records
      await idempotencyKeyService.createIdempotencyKey(
        'valid-key',
        'claim',
        'https://example.com',
        {},
        24 // 24 hours
      );

      await idempotencyKeyService.createIdempotencyKey(
        'expired-key',
        'claim',
        'https://example.com',
        {},
        -1 // Expired
      );

      // Check initial count
      const initialCount = await IdempotencyKey.count();
      expect(initialCount).toBe(2);

      // Run cleanup
      const deletedCount = await idempotencyKeyService.cleanupExpiredKeys();
      expect(deletedCount).toBe(1);

      // Check final count
      const finalCount = await IdempotencyKey.count();
      expect(finalCount).toBe(1);

      // Verify the correct record was deleted
      const remainingRecord = await IdempotencyKey.findOne({
        where: { key: 'valid-key' },
      });
      expect(remainingRecord).not.toBeNull();

      const deletedRecord = await IdempotencyKey.findOne({
        where: { key: 'expired-key' },
      });
      expect(deletedRecord).toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should provide accurate statistics', async () => {
      // Create test records with different statuses
      await idempotencyKeyService.createIdempotencyKey('key1', 'claim', 'https://example.com', {});
      await idempotencyKeyService.createIdempotencyKey('key2', 'slack', 'https://slack.com', {});
      await idempotencyKeyService.createIdempotencyKey('key3', 'email', 'user@example.com', {}, -1); // Expired

      await idempotencyKeyService.markAsCompleted('key1', 200, 'Success');
      await idempotencyKeyService.markAsFailed('key2', 'Test error');

      const stats = await idempotencyKeyService.getStatistics();

      expect(stats.total).toBe(3);
      expect(stats.expired).toBe(1);
      expect(stats.byStatus.pending).toBe(0);
      expect(stats.byStatus.completed).toBe(1);
      expect(stats.byStatus.failed).toBe(1);
    });
  });
});
