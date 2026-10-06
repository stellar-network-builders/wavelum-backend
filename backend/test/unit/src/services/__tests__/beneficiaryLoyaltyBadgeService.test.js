const BeneficiaryLoyaltyBadgeService = require('../beneficiaryLoyaltyBadgeService');
const { LoyaltyBadge, Beneficiary, Vault } = require('../../models');
const auditLogger = require('../auditLogger');

// Mock dependencies
jest.mock('../../models');
jest.mock('../auditLogger');
jest.mock('stellar-sdk', () => ({
  Server: jest.fn().mockImplementation(() => ({
    loadAccount: jest.fn()
  }))
}));

describe('BeneficiaryLoyaltyBadgeService', () => {
  let service;
  let mockServer;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BeneficiaryLoyaltyBadgeService();
    mockServer = service.server;
  });

  describe('startMonitoring', () => {
    it('should start monitoring a beneficiary successfully', async () => {
      const beneficiaryId = 'test-beneficiary-id';
      const startDate = new Date();
      
      const mockBeneficiary = {
        id: beneficiaryId,
        address: 'GD1234567890abcdef',
        total_allocated: '1000.0000000',
        vault: { id: 'test-vault-id' }
      };

      const mockBalance = '1000.0000000';
      const mockMonitoringRecord = {
        id: 'test-badge-id',
        beneficiary_id: beneficiaryId,
        badge_type: 'diamond_hands',
        monitoring_start_date: startDate,
        initial_vested_amount: '1000.0000000',
        current_balance: mockBalance,
        retention_period_days: 0,
        is_active: true
      };

      Beneficiary.findByPk.mockResolvedValue(mockBeneficiary);
      LoyaltyBadge.findOne.mockResolvedValue(null);
      service.getWalletBalance = jest.fn().mockResolvedValue(mockBalance);
      LoyaltyBadge.create.mockResolvedValue(mockMonitoringRecord);

      const result = await service.startMonitoring(beneficiaryId, startDate);

      expect(Beneficiary.findByPk).toHaveBeenCalledWith(beneficiaryId, {
        include: [{ model: Vault, as: 'vault' }]
      });
      expect(LoyaltyBadge.findOne).toHaveBeenCalledWith({
        where: {
          beneficiary_id: beneficiaryId,
          badge_type: 'diamond_hands',
          is_active: true
        }
      });
      expect(LoyaltyBadge.create).toHaveBeenCalledWith({
        beneficiary_id: beneficiaryId,
        badge_type: 'diamond_hands',
        monitoring_start_date: startDate,
        initial_vested_amount: '1000.0000000',
        current_balance: mockBalance,
        retention_period_days: 0,
        last_balance_check: expect.any(Date),
        is_active: true
      });
      expect(result.success).toBe(true);
      expect(result.message).toBe('Started monitoring beneficiary for Diamond Hands badge');
    });

    it('should return error if beneficiary not found', async () => {
      const beneficiaryId = 'non-existent-id';
      
      Beneficiary.findByPk.mockResolvedValue(null);

      await expect(service.startMonitoring(beneficiaryId))
        .rejects.toThrow('Beneficiary not found');
    });

    it('should return error if already monitoring', async () => {
      const beneficiaryId = 'test-beneficiary-id';
      
      const mockBeneficiary = {
        id: beneficiaryId,
        address: 'GD1234567890abcdef',
        total_allocated: '1000.0000000'
      };

      const existingBadge = {
        id: 'existing-badge-id',
        beneficiary_id: beneficiaryId,
        badge_type: 'diamond_hands',
        is_active: true
      };

      Beneficiary.findByPk.mockResolvedValue(mockBeneficiary);
      LoyaltyBadge.findOne.mockResolvedValue(existingBadge);

      const result = await service.startMonitoring(beneficiaryId);

      expect(result.success).toBe(false);
      expect(result.message).toContain('already being monitored');
    });
  });

  describe('getWalletBalance', () => {
    it('should return wallet balance successfully', async () => {
      const walletAddress = 'GD1234567890abcdef';
      const expectedBalance = 1000.5;

      const mockAccount = {
        balances: [
          { asset_type: 'native', balance: expectedBalance.toString() },
          { asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '500.0' }
        ]
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);

      const balance = await service.getWalletBalance(walletAddress);

      expect(mockServer.loadAccount).toHaveBeenCalledWith(walletAddress);
      expect(balance).toBe(expectedBalance);
    });

    it('should return 0 for account with no native balance', async () => {
      const walletAddress = 'GD1234567890abcdef';

      const mockAccount = {
        balances: [
          { asset_type: 'credit_alphanum4', asset_code: 'USDC', balance: '500.0' }
        ]
      };

      mockServer.loadAccount.mockResolvedValue(mockAccount);

      const balance = await service.getWalletBalance(walletAddress);

      expect(balance).toBe(0);
    });

    it('should return 0 when account not found', async () => {
      const walletAddress = 'GD1234567890abcdef';

      mockServer.loadAccount.mockRejectedValue(new Error('Account not found'));

      const balance = await service.getWalletBalance(walletAddress);

      expect(balance).toBe(0);
    });
  });

  describe('checkAndUpdateRetentionPeriods', () => {
    it('should update retention periods and award badges when threshold met', async () => {
      const mockActiveMonitoring = [
        {
          id: 'badge-1',
          beneficiary_id: 'beneficiary-1',
          retention_period_days: 364,
          current_balance: '1000.0',
          monitoring_start_date: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          beneficiary: {
            address: 'GD1234567890abcdef',
            id: 'beneficiary-1'
          },
          update: jest.fn().mockResolvedValue(true)
        }
      ];

      LoyaltyBadge.findAll.mockResolvedValue(mockActiveMonitoring);
      service.getWalletBalance = jest.fn().mockResolvedValue('1000.0');
      service.awardDiamondHandsBadge = jest.fn().mockResolvedValue({
        success: true,
        message: 'Badge awarded'
      });

      const result = await service.checkAndUpdateRetentionPeriods();

      expect(result.checked).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.badgesAwarded).toBe(1);
      expect(service.awardDiamondHandsBadge).toHaveBeenCalledWith('badge-1');
    });

    it('should deactivate monitoring if tokens were sold', async () => {
      const mockActiveMonitoring = [
        {
          id: 'badge-1',
          beneficiary_id: 'beneficiary-1',
          current_balance: '1000.0',
          beneficiary: {
            address: 'GD1234567890abcdef',
            id: 'beneficiary-1'
          },
          update: jest.fn().mockResolvedValue(true)
        }
      ];

      LoyaltyBadge.findAll.mockResolvedValue(mockActiveMonitoring);
      service.getWalletBalance = jest.fn().mockResolvedValue('500.0'); // Lower than current balance

      const result = await service.checkAndUpdateRetentionPeriods();

      expect(result.checked).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.badgesAwarded).toBe(0);
      expect(mockActiveMonitoring[0].update).toHaveBeenCalledWith({
        is_active: false,
        last_balance_check: expect.any(Date)
      });
    });
  });

  describe('awardDiamondHandsBadge', () => {
    it('should award Diamond Hands badge successfully', async () => {
      const badgeId = 'test-badge-id';
      const mockBadgeRecord = {
        id: badgeId,
        beneficiary_id: 'beneficiary-1',
        retention_period_days: 365,
        awarded_at: null,
        beneficiary: {
          id: 'beneficiary-1',
          address: 'GD1234567890abcdef'
        },
        update: jest.fn().mockResolvedValue(true)
      };

      LoyaltyBadge.findByPk.mockResolvedValue(mockBadgeRecord);
      service.grantDiscordRole = jest.fn().mockResolvedValue(true);
      service.grantPriorityAccess = jest.fn().mockResolvedValue(true);
      service.mintBadgeNFT = jest.fn().mockResolvedValue('https://metadata.example.com/badge/1');

      const result = await service.awardDiamondHandsBadge(badgeId);

      expect(LoyaltyBadge.findByPk).toHaveBeenCalledWith(badgeId, {
        include: [{ model: Beneficiary, as: 'beneficiary' }]
      });
      expect(mockBadgeRecord.update).toHaveBeenCalledWith({
        awarded_at: expect.any(Date),
        is_active: false
      });
      expect(service.grantDiscordRole).toHaveBeenCalledWith(mockBadgeRecord.beneficiary);
      expect(service.grantPriorityAccess).toHaveBeenCalledWith(mockBadgeRecord.beneficiary);
      expect(service.mintBadgeNFT).toHaveBeenCalledWith(mockBadgeRecord.beneficiary);
      expect(result.success).toBe(true);
      expect(result.message).toBe('Diamond Hands badge awarded successfully');
    });

    it('should return error if badge record not found', async () => {
      const badgeId = 'non-existent-badge-id';

      LoyaltyBadge.findByPk.mockResolvedValue(null);

      await expect(service.awardDiamondHandsBadge(badgeId))
        .rejects.toThrow('Loyalty badge record not found');
    });

    it('should return error if badge already awarded', async () => {
      const badgeId = 'already-awarded-badge';
      const mockBadgeRecord = {
        id: badgeId,
        awarded_at: new Date(),
        beneficiary: { address: 'GD1234567890abcdef' }
      };

      LoyaltyBadge.findByPk.mockResolvedValue(mockBadgeRecord);

      await expect(service.awardDiamondHandsBadge(badgeId))
        .rejects.toThrow('Badge already awarded');
    });
  });

  describe('getBeneficiaryBadges', () => {
    it('should return all badges for a beneficiary', async () => {
      const beneficiaryId = 'beneficiary-1';
      const mockBadges = [
        { id: 'badge-1', beneficiary_id: beneficiaryId, badge_type: 'diamond_hands' },
        { id: 'badge-2', beneficiary_id: beneficiaryId, badge_type: 'platinum_hodler' }
      ];

      LoyaltyBadge.findAll.mockResolvedValue(mockBadges);

      const result = await service.getBeneficiaryBadges(beneficiaryId);

      expect(LoyaltyBadge.findAll).toHaveBeenCalledWith({
        where: { beneficiary_id: beneficiaryId },
        include: [{ model: Beneficiary, as: 'beneficiary' }],
        order: [['created_at', 'DESC']]
      });
      expect(result).toEqual(mockBadges);
    });
  });

  describe('getDiamondHandsHolders', () => {
    it('should return all Diamond Hands badge holders', async () => {
      const mockHolders = [
        { 
          id: 'badge-1', 
          badge_type: 'diamond_hands', 
          awarded_at: new Date(),
          beneficiary: { address: 'GD1234567890abcdef' }
        }
      ];

      LoyaltyBadge.findAll.mockResolvedValue(mockHolders);

      const result = await service.getDiamondHandsHolders();

      expect(LoyaltyBadge.findAll).toHaveBeenCalledWith({
        where: {
          badge_type: 'diamond_hands',
          awarded_at: { [require('sequelize').Op.ne]: null }
        },
        include: [{ model: Beneficiary, as: 'beneficiary' }],
        order: [['awarded_at', 'DESC']]
      });
      expect(result).toEqual(mockHolders);
    });
  });

  describe('getMonitoringStatistics', () => {
    it('should return monitoring statistics', async () => {
      const mockStats = [{
        total: '10',
        awarded: '3',
        active_monitoring: '7',
        avg_retention_days: '180.5'
      }];

      LoyaltyBadge.findAll.mockResolvedValue(mockStats);

      const result = await service.getMonitoringStatistics();

      expect(LoyaltyBadge.findAll).toHaveBeenCalledWith({
        attributes: [
          [require('sequelize').fn('COUNT', require('sequelize').col('id')), 'total'],
          [require('sequelize').fn('COUNT', require('sequelize').literal('CASE WHEN awarded_at IS NOT NULL THEN 1 END')), 'awarded'],
          [require('sequelize').fn('COUNT', require('sequelize').literal('CASE WHEN is_active = true THEN 1 END')), 'active_monitoring'],
          [require('sequelize').fn('AVG', require('sequelize').col('retention_period_days')), 'avg_retention_days']
        ],
        where: { badge_type: 'diamond_hands' },
        raw: true
      });
      expect(result.total_monitored).toBe(10);
      expect(result.badges_awarded).toBe(3);
      expect(result.active_monitoring).toBe(7);
      expect(result.average_retention_days).toBe(180.5);
    });
  });

  describe('grantDiscordRole', () => {
    it('should grant Discord role when webhook is configured', async () => {
      const originalEnv = process.env.DISCORD_WEBHOOK_URL;
      process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/test';

      const mockBeneficiary = { address: 'GD1234567890abcdef' };
      
      const result = await service.grantDiscordRole(mockBeneficiary);

      expect(result).toBe(true);
      
      process.env.DISCORD_WEBHOOK_URL = originalEnv;
    });

    it('should return false when webhook is not configured', async () => {
      const originalEnv = process.env.DISCORD_WEBHOOK_URL;
      delete process.env.DISCORD_WEBHOOK_URL;

      const mockBeneficiary = { address: 'GD1234567890abcdef' };
      
      const result = await service.grantDiscordRole(mockBeneficiary);

      expect(result).toBe(false);
      
      process.env.DISCORD_WEBHOOK_URL = originalEnv;
    });
  });

  describe('grantPriorityAccess', () => {
    it('should grant priority access successfully', async () => {
      const mockBeneficiary = { address: 'GD1234567890abcdef' };
      
      const result = await service.grantPriorityAccess(mockBeneficiary);

      expect(result).toBe(true);
    });
  });

  describe('mintBadgeNFT', () => {
    it('should mint NFT badge and return metadata URI', async () => {
      const mockBeneficiary = { id: 'beneficiary-1', address: 'GD1234567890abcdef' };
      
      const result = await service.mintBadgeNFT(mockBeneficiary);

      expect(result).toBe('https://metadata.example.com/badges/diamond-hands/beneficiary-1');
    });
  });
});
