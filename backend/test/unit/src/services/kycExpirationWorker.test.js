/**
 * Tests for KYCExpirationWorker
 */

const kycExpirationWorker = require('./kycExpirationWorker');
const { KycStatus, KycNotification } = require('../models');
const { sequelize } = require('../database/connection');

// Mock external dependencies
jest.mock('./notificationService');
jest.mock('./slackWebhookService');

describe('KYCExpirationWorker', () => {
  let testKycStatuses = [];

  beforeAll(async () => {
    // Setup test database
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    // Clean up test database
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up before each test
    await KycStatus.destroy({ where: {} });
    await KycNotification.destroy({ where: {} });
    testKycStatuses = [];
  });

  describe('User Expiration Processing', () => {
    test('should process user expiring within 7 days', async () => {
      // Create user expiring in 3 days
      const expiringUser = await KycStatus.createKycStatus({
        userAddress: '0xexpiringuserexpiringuserexpiring',
        kycStatus: 'VERIFIED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        expirationDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days from now
        riskScore: 0.25,
        riskLevel: 'LOW'
      });
      testKycStatuses.push(expiringUser);

      const stats = await kycExpirationWorker.processExpiringUsers();

      expect(stats.totalProcessed).toBe(1);
      expect(stats.criticalUsers).toBe(1);
      expect(stats.softLocksApplied).toBe(1);
      expect(stats.notificationsSent).toBe(1);

      // Check that soft-lock was applied
      const updatedUser = await KycStatus.findByPk(expiringUser.id);
      expect(updatedUser.soft_lock_enabled).toBe(true);
      expect(updatedUser.kyc_status).toBe('SOFT_LOCKED');
    });

    test('should process user expiring within 24 hours', async () => {
      // Create user expiring in 12 hours
      const criticalUser = await KycStatus.createKycStatus({
        userAddress: '0xcriticalusercriticalusercritical',
        kycStatus: 'VERIFIED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12 hours from now
        riskScore: 0.25,
        riskLevel: 'LOW'
      });
      testKycStatuses.push(criticalUser);

      const stats = await kycExpirationWorker.processExpiringUsers();

      expect(stats.totalProcessed).toBe(1);
      expect(stats.criticalUsers).toBe(1);
      expect(stats.softLocksApplied).toBe(1);

      // Check notification was sent
      const notifications = await KycNotification.findAll({
        where: { user_address: criticalUser.user_address }
      });
      expect(notifications.length).toBe(1);
      expect(notifications[0].notification_type).toBe('SOFT_LOCK');
      expect(notifications[0].urgency_level).toBe('CRITICAL');
    });

    test('should process user with warning expiration (5 days)', async () => {
      // Create user expiring in 5 days
      const warningUser = await KycStatus.createKycStatus({
        userAddress: '0xwarninguserwarninguserwarninguser',
        kycStatus: 'VERIFIED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
        riskScore: 0.25,
        riskLevel: 'LOW'
      });
      testKycStatuses.push(warningUser);

      const stats = await kycExpirationWorker.processExpiringUsers();

      expect(stats.totalProcessed).toBe(1);
      expect(stats.warningUsers).toBe(1);
      expect(stats.softLocksApplied).toBe(0); // No soft-lock for 5 days
      expect(stats.notificationsSent).toBe(1);

      // Check that user is still verified
      const updatedUser = await KycStatus.findByPk(warningUser.id);
      expect(updatedUser.kyc_status).toBe('VERIFIED');
      expect(updatedUser.soft_lock_enabled).toBe(false);
    });

    test('should process expired users', async () => {
      // Create user that expired yesterday
      const expiredUser = await KycStatus.createKycStatus({
        userAddress: '0xexpireduserexpireduserexpired',
        kycStatus: 'VERIFIED',
        verificationDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
        expirationDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
        riskScore: 0.25,
        riskLevel: 'LOW'
      });
      testKycStatuses.push(expiredUser);

      const stats = await kycExpirationWorker.processExpiringUsers();

      expect(stats.totalProcessed).toBe(1);
      expect(stats.expiredUsers).toBe(1);
      expect(stats.softLocksApplied).toBe(1);

      // Check that status was updated to expired
      const updatedUser = await KycStatus.findByPk(expiredUser.id);
      expect(updatedUser.kyc_status).toBe('EXPIRED');
      expect(updatedUser.soft_lock_enabled).toBe(true);
    });

    test('should skip users already soft-locked', async () => {
      // Create user expiring in 2 days but already soft-locked
      const lockedUser = await KycStatus.createKycStatus({
        userAddress: '0xlockeduserlockeduserlockeduser',
        kycStatus: 'SOFT_LOCKED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
        riskScore: 0.25,
        riskLevel: 'LOW',
        softLockEnabled: true,
        softLockReason: 'Previously locked'
      });
      testKycStatuses.push(lockedUser);

      const stats = await kycExpirationWorker.processExpiringUsers();

      expect(stats.totalProcessed).toBe(0); // Should not process already locked users
    });

    test('should skip users with valid KYC', async () => {
      // Create user with KYC expiring in 30 days
      const validUser = await KycStatus.createKycStatus({
        userAddress: '0xvaliduservaliduservaliduservalid',
        kycStatus: 'VERIFIED',
        verificationDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        riskScore: 0.25,
        riskLevel: 'LOW'
      });
      testKycStatuses.push(validUser);

      const stats = await kycExpirationWorker.processExpiringUsers();

      expect(stats.totalProcessed).toBe(0); // Should not process users not expiring soon
    });
  });

  describe('Notification Sending', () => {
    test('should send critical notification for expiring user', async () => {
      const criticalUser = await KycStatus.createKycStatus({
        userAddress: '0xcriticalnotificationcritical',
        kycStatus: 'VERIFIED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 1 day from now
        riskScore: 0.25,
        riskLevel: 'LOW'
      });

      await kycExpirationWorker.processCriticalExpiration(criticalUser);

      const notifications = await KycNotification.findAll({
        where: { user_address: criticalUser.user_address }
      });

      expect(notifications.length).toBe(1);
      expect(notifications[0].notification_type).toBe('EXPIRATION_WARNING');
      expect(notifications[0].urgency_level).toBe('CRITICAL');
      expect(notifications[0].action_required).toBe(true);
      expect(notifications[0].action_type).toBe('REVERIFY_KYC');
    });

    test('should send soft-lock notification', async () => {
      const user = await KycStatus.createKycStatus({
        userAddress: '0xsoftlocknotificationsoftlock',
        kycStatus: 'VERIFIED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        riskScore: 0.25,
        riskLevel: 'LOW'
      });

      await user.applySoftLock('Test soft-lock');
      await kycExpirationWorker.sendNotification(user, 'SOFT_LOCK', 'CRITICAL');

      const notifications = await KycNotification.findAll({
        where: { user_address: user.user_address }
      });

      expect(notifications.length).toBe(1);
      expect(notifications[0].notification_type).toBe('SOFT_LOCK');
      expect(notifications[0].urgency_level).toBe('CRITICAL');
      expect(notifications[0].title).toBe('Account Temporarily Locked');
    });
  });

  describe('Compliance Status', () => {
    test('should return correct compliance status for verified user', async () => {
      const verifiedUser = await KycStatus.createKycStatus({
        userAddress: '0xverifieduserverifieduserverified',
        kycStatus: 'VERIFIED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        riskScore: 0.25,
        riskLevel: 'LOW'
      });

      const complianceStatus = verifiedUser.getComplianceStatus();

      expect(complianceStatus.status).toBe('VERIFIED');
      expect(complianceStatus.canClaim).toBe(true);
      expect(complianceStatus.urgency).toBe('LOW');
    });

    test('should return correct compliance status for expiring user', async () => {
      const expiringUser = await KycStatus.createKycStatus({
        userAddress: '0xexpiringstatususerexpiringstatus',
        kycStatus: 'VERIFIED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        riskScore: 0.25,
        riskLevel: 'LOW'
      });

      const complianceStatus = expiringUser.getComplianceStatus();

      expect(complianceStatus.status).toBe('EXPIRING_SOON');
      expect(complianceStatus.canClaim).toBe(false); // 3 days = no claim
      expect(complianceStatus.urgency).toBe('CRITICAL');
    });

    test('should return correct compliance status for soft-locked user', async () => {
      const lockedUser = await KycStatus.createKycStatus({
        userAddress: '0xlockedstatususerlockedstatususer',
        kycStatus: 'SOFT_LOCKED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        riskScore: 0.25,
        riskLevel: 'LOW',
        softLockEnabled: true,
        softLockReason: 'Test lock'
      });

      const complianceStatus = lockedUser.getComplianceStatus();

      expect(complianceStatus.status).toBe('SOFT_LOCKED');
      expect(complianceStatus.canClaim).toBe(false);
      expect(complianceStatus.urgency).toBe('CRITICAL');
    });

    test('should return correct compliance status for expired user', async () => {
      const expiredUser = await KycStatus.createKycStatus({
        userAddress: '0xexpiredstatususerexpiredstatususer',
        kycStatus: 'EXPIRED',
        verificationDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
        riskScore: 0.25,
        riskLevel: 'LOW'
      });

      const complianceStatus = expiredUser.getComplianceStatus();

      expect(complianceStatus.status).toBe('EXPIRED');
      expect(complianceStatus.canClaim).toBe(false);
      expect(complianceStatus.urgency).toBe('CRITICAL');
    });
  });

  describe('Soft Lock Management', () => {
    test('should apply soft lock correctly', async () => {
      const user = await KycStatus.createKycStatus({
        userAddress: '0xsoftlockapplysoftlockapply',
        kycStatus: 'VERIFIED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        riskScore: 0.25,
        riskLevel: 'LOW'
      });

      await user.applySoftLock('Test reason');

      const updatedUser = await KycStatus.findByPk(user.id);
      expect(updatedUser.soft_lock_enabled).toBe(true);
      expect(updatedUser.kyc_status).toBe('SOFT_LOCKED');
      expect(updatedUser.soft_lock_reason).toBe('Test reason');
      expect(updatedUser.soft_lock_date).toBeDefined();
    });

    test('should remove soft lock correctly', async () => {
      const user = await KycStatus.createKycStatus({
        userAddress: '0xsoftlockremovesoftlockremove',
        kycStatus: 'SOFT_LOCKED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        riskScore: 0.25,
        riskLevel: 'LOW',
        softLockEnabled: true,
        softLockReason: 'Test lock'
      });

      await user.removeSoftLock('Test unlock');

      const updatedUser = await KycStatus.findByPk(user.id);
      expect(updatedUser.soft_lock_enabled).toBe(false);
      expect(updatedUser.kyc_status).toBe('VERIFIED');
      expect(updatedUser.soft_lock_reason).toBeNull();
      expect(updatedUser.soft_lock_date).toBeNull();
    });
  });

  describe('Statistics and Reporting', () => {
    test('should generate compliance statistics', async () => {
      // Create test users with different statuses
      await KycStatus.createKycStatus({
        userAddress: '0xstatsuser1statsuser1statsuser1',
        kycStatus: 'VERIFIED',
        riskScore: 0.25,
        riskLevel: 'LOW'
      });

      await KycStatus.createKycStatus({
        userAddress: '0xstatsuser2statsuser2statsuser2',
        kycStatus: 'SOFT_LOCKED',
        riskScore: 0.75,
        riskLevel: 'HIGH',
        softLockEnabled: true
      });

      await KycStatus.createKycStatus({
        userAddress: '0xstatsuser3statsuser3statsuser3',
        kycStatus: 'PENDING',
        riskScore: 0.50,
        riskLevel: 'MEDIUM'
      });

      const stats = await KycStatus.getComplianceStatistics();

      expect(stats.totalUsers).toBe(3);
      expect(stats.verifiedUsers).toBe(1);
      expect(stats.softLockedUsers).toBe(1);
      expect(stats.complianceRate).toBe('33.33');
      expect(stats.riskBreakdown.LOW).toBe(1);
      expect(stats.riskBreakdown.MEDIUM).toBe(1);
      expect(stats.riskBreakdown.HIGH).toBe(1);
      expect(stats.statusBreakdown.VERIFIED).toBe(1);
      expect(stats.statusBreakdown.SOFT_LOCKED).toBe(1);
      expect(stats.statusBreakdown.PENDING).toBe(1);
    });

    test('should generate notification statistics', async () => {
      const user = await KycStatus.createKycStatus({
        userAddress: '0xnotifstatsusernotifstatsuser',
        kycStatus: 'VERIFIED',
        riskScore: 0.25,
        riskLevel: 'LOW'
      });

      // Create test notifications
      await KycNotification.createNotification({
        userAddress: user.user_address,
        kycStatusId: user.id,
        notificationType: 'EXPIRATION_WARNING',
        urgencyLevel: 'HIGH',
        title: 'Test Notification',
        message: 'Test message'
      });

      await KycNotification.createNotification({
        userAddress: user.user_address,
        kycStatusId: user.id,
        notificationType: 'EXPIRED',
        urgencyLevel: 'CRITICAL',
        title: 'Test Notification 2',
        message: 'Test message 2'
      });

      const stats = await KycNotification.getNotificationStatistics(user.user_address);

      expect(stats.totalNotifications).toBe(2);
      expect(stats.readNotifications).toBe(0);
      expect(stats.actionRequired).toBe(2);
      expect(stats.typeBreakdown.EXPIRATION_WARNING).toBe(1);
      expect(stats.typeBreakdown.EXPIRED).toBe(1);
      expect(stats.urgencyBreakdown.HIGH).toBe(1);
      expect(stats.urgencyBreakdown.CRITICAL).toBe(1);
    });
  });

  describe('Worker Status', () => {
    test('should return worker status', () => {
      const status = kycExpirationWorker.getStatus();

      expect(status).toHaveProperty('isRunning');
      expect(status).toHaveProperty('lastRunTime');
      expect(status).toHaveProperty('processedUsersCount');
      expect(status).toHaveProperty('uptime');
    });
  });

  describe('Error Handling', () => {
    test('should handle notification delivery failures gracefully', async () => {
      const user = await KycStatus.createKycStatus({
        userAddress: '0xerrorhandlingusererrorhandling',
        kycStatus: 'VERIFIED',
        verificationDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        expirationDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
        riskScore: 0.25,
        riskLevel: 'LOW'
      });

      // Mock notification service to throw error
      const notificationService = require('./notificationService');
      notificationService.sendPushNotification.mockRejectedValue(new Error('Notification failed'));

      // Should not throw error, but should continue processing
      const stats = await kycExpirationWorker.processExpiringUsers();

      expect(stats.totalProcessed).toBe(1);
      expect(stats.criticalUsers).toBe(1);
    });

    test('should handle database errors gracefully', async () => {
      // Mock KycStatus.findExpiringSoon to throw error
      const originalFindExpiringSoon = KycStatus.findExpiringSoon;
      KycStatus.findExpiringSoon = jest.fn().mockRejectedValue(new Error('Database error'));

      const stats = await kycExpirationWorker.processExpiringUsers();

      expect(stats.totalProcessed).toBe(0);

      // Restore original method
      KycStatus.findExpiringSoon = originalFindExpiringSoon;
    });
  });
});
