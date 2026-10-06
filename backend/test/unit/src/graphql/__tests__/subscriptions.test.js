const { 
  subscriptionResolver, 
  publishVaultUpdate, 
  publishBeneficiaryUpdate, 
  publishNewClaim, 
  publishWithdrawalProcessed,
  publishAuditLogCreated,
  publishAdminTransferUpdated,
  SUBSCRIPTION_EVENTS,
  pubsub
} = require('../subscriptions/proofSubscription');
const { models } = require('../../models');

// Mock models
jest.mock('../../models', () => ({
  models: {
    Vault: {
      findOne: jest.fn(),
      findAll: jest.fn()
    },
    Beneficiary: {
      findOne: jest.fn(),
      findAll: jest.fn()
    },
    ClaimsHistory: {
      findOne: jest.fn(),
      findAll: jest.fn()
    }
  }
}));

// Mock pubsub
jest.mock('graphql-subscriptions', () => ({
  PubSub: jest.fn().mockImplementation(() => ({
    asyncIterator: jest.fn(),
    publish: jest.fn()
  }))
}));

describe('GraphQL Subscriptions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Subscription Resolver', () => {
    describe('vaultUpdated', () => {
      it('should subscribe to vault updates for specific vault', () => {
        const mockAsyncIterator = jest.fn();
        pubsub.asyncIterator.mockReturnValue(mockAsyncIterator);

        subscriptionResolver.Subscription.vaultUpdated.subscribe(
          null, 
          { vaultAddress: '0x123...' }
        );

        expect(pubsub.asyncIterator).toHaveBeenCalledWith([
          `${SUBSCRIPTION_EVENTS.VAULT_UPDATED}_0x123...`
        ]);
      });

      it('should subscribe to all vault updates when no address provided', () => {
        const mockAsyncIterator = jest.fn();
        pubsub.asyncIterator.mockReturnValue(mockAsyncIterator);

        subscriptionResolver.Subscription.vaultUpdated.subscribe(null, {});

        expect(pubsub.asyncIterator).toHaveBeenCalledWith([
          SUBSCRIPTION_EVENTS.VAULT_UPDATED
        ]);
      });
    });

    describe('beneficiaryUpdated', () => {
      it('should subscribe to beneficiary updates for specific beneficiary', () => {
        const mockAsyncIterator = jest.fn();
        pubsub.asyncIterator.mockReturnValue(mockAsyncIterator);

        subscriptionResolver.Subscription.beneficiaryUpdated.subscribe(
          null, 
          { 
            vaultAddress: '0x123...', 
            beneficiaryAddress: '0xbeneficiary...' 
          }
        );

        expect(pubsub.asyncIterator).toHaveBeenCalledWith([
          `${SUBSCRIPTION_EVENTS.BENEFICIARY_UPDATED}_0x123..._0xbeneficiary...`
        ]);
      });

      it('should subscribe to vault-specific beneficiary updates', () => {
        const mockAsyncIterator = jest.fn();
        pubsub.asyncIterator.mockReturnValue(mockAsyncIterator);

        subscriptionResolver.Subscription.beneficiaryUpdated.subscribe(
          null, 
          { vaultAddress: '0x123...' }
        );

        expect(pubsub.asyncIterator).toHaveBeenCalledWith([
          `${SUBSCRIPTION_EVENTS.BENEFICIARY_UPDATED}_0x123...`
        ]);
      });
    });

    describe('newClaim', () => {
      it('should subscribe to claims for specific user', () => {
        const mockAsyncIterator = jest.fn();
        pubsub.asyncIterator.mockReturnValue(mockAsyncIterator);

        subscriptionResolver.Subscription.newClaim.subscribe(
          null, 
          { userAddress: '0xuser...' }
        );

        expect(pubsub.asyncIterator).toHaveBeenCalledWith([
          `${SUBSCRIPTION_EVENTS.NEW_CLAIM}_0xuser...`
        ]);
      });
    });

    describe('withdrawalProcessed', () => {
      it('should subscribe to withdrawal updates for specific beneficiary', () => {
        const mockAsyncIterator = jest.fn();
        pubsub.asyncIterator.mockReturnValue(mockAsyncIterator);

        subscriptionResolver.Subscription.withdrawalProcessed.subscribe(
          null, 
          { 
            vaultAddress: '0x123...', 
            beneficiaryAddress: '0xbeneficiary...' 
          }
        );

        expect(pubsub.asyncIterator).toHaveBeenCalledWith([
          `${SUBSCRIPTION_EVENTS.WITHDRAWAL_PROCESSED}_0x123..._0xbeneficiary...`
        ]);
      });
    });

    describe('auditLogCreated', () => {
      it('should subscribe to all audit logs', () => {
        const mockAsyncIterator = jest.fn();
        pubsub.asyncIterator.mockReturnValue(mockAsyncIterator);

        subscriptionResolver.Subscription.auditLogCreated.subscribe(null, {});

        expect(pubsub.asyncIterator).toHaveBeenCalledWith([
          SUBSCRIPTION_EVENTS.AUDIT_LOG_CREATED
        ]);
      });
    });

    describe('adminTransferUpdated', () => {
      it('should subscribe to admin transfers for specific contract', () => {
        const mockAsyncIterator = jest.fn();
        pubsub.asyncIterator.mockReturnValue(mockAsyncIterator);

        subscriptionResolver.Subscription.adminTransferUpdated.subscribe(
          null, 
          { contractAddress: '0xcontract...' }
        );

        expect(pubsub.asyncIterator).toHaveBeenCalledWith([
          `${SUBSCRIPTION_EVENTS.ADMIN_TRANSFER_UPDATED}_0xcontract...`
        ]);
      });
    });
  });

  describe('Publish Functions', () => {
    describe('publishVaultUpdate', () => {
      it('should publish vault update to general and specific channels', async () => {
        const mockVault = {
          id: '1',
          address: '0x123...',
          beneficiaries: [],
          subSchedules: []
        };

      models.Vault.findOne.mockResolvedValue(mockVault);
      pubsub.publish.mockImplementation();

        await publishVaultUpdate('0x123...', mockVault);

        expect(models.Vault.findOne).toHaveBeenCalledWith({
          where: { address: '0x123...' },
          include: [
            { model: models.Beneficiary, as: 'beneficiaries' },
            { model: models.SubSchedule, as: 'subSchedules' }
          ]
        });

        expect(pubsub.publish).toHaveBeenCalledWith(
          SUBSCRIPTION_EVENTS.VAULT_UPDATED,
          { vaultUpdated: mockVault }
        );

        expect(pubsub.publish).toHaveBeenCalledWith(
          `${SUBSCRIPTION_EVENTS.VAULT_UPDATED}_0x123...`,
          { vaultUpdated: mockVault }
        );
      });

      it('should handle errors gracefully', async () => {
        models.Vault.findOne.mockRejectedValue(new Error('Database error'));
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

        await publishVaultUpdate('0x123...', {});

        expect(consoleSpy).toHaveBeenCalledWith('Error publishing vault update:', expect.any(Error));
        
        consoleSpy.mockRestore();
      });
    });

    describe('publishBeneficiaryUpdate', () => {
      it('should publish beneficiary update to all relevant channels', async () => {
        const mockVault = { id: '1', address: '0x123...' };
        const mockBeneficiary = {
          id: '1',
          vault_id: '1',
          address: '0xbeneficiary...',
          vault: mockVault
        };

      models.Vault.findOne.mockResolvedValue(mockVault);
        models.Beneficiary.findOne.mockResolvedValue(mockBeneficiary);
      pubsub.publish.mockImplementation();

        await publishBeneficiaryUpdate('0x123...', '0xbeneficiary...', mockBeneficiary);

        expect(pubsub.publish).toHaveBeenCalledWith(
          SUBSCRIPTION_EVENTS.BENEFICIARY_UPDATED,
          { beneficiaryUpdated: mockBeneficiary }
        );

        expect(pubsub.publish).toHaveBeenCalledWith(
          `${SUBSCRIPTION_EVENTS.BENEFICIARY_UPDATED}_0x123...`,
          { beneficiaryUpdated: mockBeneficiary }
        );

        expect(pubsub.publish).toHaveBeenCalledWith(
          `${SUBSCRIPTION_EVENTS.BENEFICIARY_UPDATED}_0x123..._0xbeneficiary...`,
          { beneficiaryUpdated: mockBeneficiary }
        );
      });
    });

    describe('publishNewClaim', () => {
      it('should publish new claim to general and user-specific channels', async () => {
        const mockClaim = {
          id: '1',
          user_address: '0xuser...',
          token_address: '0xtoken...',
          amount_claimed: '100'
        };

        models.ClaimsHistory.findOne.mockResolvedValue(mockClaim);
      pubsub.publish.mockImplementation();

        await publishNewClaim('0xuser...', { transactionHash: '0xtx...' });

        expect(pubsub.publish).toHaveBeenCalledWith(
          SUBSCRIPTION_EVENTS.NEW_CLAIM,
          { newClaim: mockClaim }
        );

        expect(pubsub.publish).toHaveBeenCalledWith(
          `${SUBSCRIPTION_EVENTS.NEW_CLAIM}_0xuser...`,
          { newClaim: mockClaim }
        );
      });
    });

    describe('publishWithdrawalProcessed', () => {
      it('should publish withdrawal processed to all relevant channels', async () => {
        const withdrawableInfo = {
          totalWithdrawable: '50',
          vestedAmount: '200',
          remainingAmount: '150'
        };

        pubsub.publish.mockImplementation();

        await publishWithdrawalProcessed('0x123...', '0xbeneficiary...', withdrawableInfo);

        expect(pubsub.publish).toHaveBeenCalledWith(
          SUBSCRIPTION_EVENTS.WITHDRAWAL_PROCESSED,
          { withdrawalProcessed: withdrawableInfo }
        );

        expect(pubsub.publish).toHaveBeenCalledWith(
          `${SUBSCRIPTION_EVENTS.WITHDRAWAL_PROCESSED}_0x123...`,
          { withdrawalProcessed: withdrawableInfo }
        );

        expect(pubsub.publish).toHaveBeenCalledWith(
          `${SUBSCRIPTION_EVENTS.WITHDRAWAL_PROCESSED}_0x123..._0xbeneficiary...`,
          { withdrawalProcessed: withdrawableInfo }
        );
      });
    });

    describe('publishAuditLogCreated', () => {
      it('should publish audit log created event', async () => {
        const auditLog = {
          id: '1',
          adminAddress: '0xadmin...',
          action: 'REVOKE_ACCESS',
          timestamp: new Date()
        };

        pubsub.publish.mockImplementation();

        await publishAuditLogCreated(auditLog);

        expect(pubsub.publish).toHaveBeenCalledWith(
          SUBSCRIPTION_EVENTS.AUDIT_LOG_CREATED,
          { auditLogCreated: auditLog }
        );
      });
    });

    describe('publishAdminTransferUpdated', () => {
      it('should publish admin transfer updated to general and contract-specific channels', async () => {
        const transferData = {
          id: '1',
          currentAdminAddress: '0xadmin...',
          newAdminAddress: '0xnewadmin...',
          contractAddress: '0xcontract...'
        };

        pubsub.publish.mockImplementation();

        await publishAdminTransferUpdated('0xcontract...', transferData);

        expect(pubsub.publish).toHaveBeenCalledWith(
          SUBSCRIPTION_EVENTS.ADMIN_TRANSFER_UPDATED,
          { adminTransferUpdated: transferData }
        );

        expect(pubsub.publish).toHaveBeenCalledWith(
          `${SUBSCRIPTION_EVENTS.ADMIN_TRANSFER_UPDATED}_0xcontract...`,
          { adminTransferUpdated: transferData }
        );
      });
    });
  });

  describe('Subscription Event Constants', () => {
    it('should have correct event names', () => {
      expect(SUBSCRIPTION_EVENTS.VAULT_UPDATED).toBe('VAULT_UPDATED');
      expect(SUBSCRIPTION_EVENTS.BENEFICIARY_UPDATED).toBe('BENEFICIARY_UPDATED');
      expect(SUBSCRIPTION_EVENTS.NEW_CLAIM).toBe('NEW_CLAIM');
      expect(SUBSCRIPTION_EVENTS.WITHDRAWAL_PROCESSED).toBe('WITHDRAWAL_PROCESSED');
      expect(SUBSCRIPTION_EVENTS.AUDIT_LOG_CREATED).toBe('AUDIT_LOG_CREATED');
      expect(SUBSCRIPTION_EVENTS.ADMIN_TRANSFER_UPDATED).toBe('ADMIN_TRANSFER_UPDATED');
    });
  });

  describe('Error Handling', () => {
    it('should handle publish errors gracefully', async () => {
      pubsub.publish.mockImplementation(() => {
        throw new Error('Publish error');
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await publishAuditLogCreated({ id: '1' });

      expect(consoleSpy).toHaveBeenCalledWith('Error publishing audit log created:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });

    it('should handle missing vault in publishVaultUpdate', async () => {
      models.Vault.findOne.mockResolvedValue(null);
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await publishVaultUpdate('0x123...', {});

      expect(consoleSpy).toHaveBeenCalledWith('Error publishing vault update:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });
  });
});
