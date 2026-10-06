const models = require('../../models');
const { vaultResolver } = require('../resolvers/vaultResolver');
const { userResolver } = require('../resolvers/userResolver');
const { proofResolver } = require('../resolvers/proofResolver');

// Mock models
jest.mock('../../models', () => ({
  Vault: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  Beneficiary: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn()
  },
  SubSchedule: {
    create: jest.fn(),
    findAll: jest.fn()
  },
  ClaimsHistory: {
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn()
  },
  Sequelize: {
    Op: {
      in: Symbol('in'),
      gte: jest.fn(),
      lte: jest.fn()
    }
  }
}));

jest.mock('../middleware/auth', () => ({
  isAdminOfOrg: jest.fn().mockResolvedValue(true),
  canAccessVault: jest.fn().mockResolvedValue({ canAccess: true, role: 'admin' }),
  authMiddleware: jest.fn().mockImplementation(() => (resolve) => resolve()),
  vaultAccessMiddleware: jest.fn().mockImplementation(() => (resolve) => resolve()),
  adaptiveRateLimitMiddleware: jest.fn().mockImplementation(() => (resolve) => resolve())
}));

describe('GraphQL Resolvers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Vault Resolver', () => {

    describe('Query.vault', () => {
      it('should fetch a vault by address', async () => {
        const mockVault = {
          id: '1',
          address: '0x123...',
          name: 'Test Vault',
          token_address: '0xabc...',
          owner_address: '0xowner...',
          total_amount: '1000',
          beneficiaries: [],
          subSchedules: []
        };

        models.Vault.findOne.mockResolvedValue(mockVault);

        const result = await vaultResolver.Query.vault(null, { address: '0x123...' });

        expect(models.Vault.findOne).toHaveBeenCalledWith({
          where: { address: '0x123...' },
          include: [
            { model: models.Beneficiary, as: 'beneficiaries' },
            { model: models.SubSchedule, as: 'subSchedules' }
          ]
        });
        expect(result).toEqual(mockVault);
      });

      it('should return null for non-existent vault', async () => {
        models.Vault.findOne.mockResolvedValue(null);

        const result = await vaultResolver.Query.vault(null, { address: '0x123...' });
        expect(result).toBeNull();
      });

      it('should deny access when admin does not belong to org', async () => {
        const { isAdminOfOrg } = require('../middleware/auth');
        isAdminOfOrg.mockResolvedValueOnce(false);

        await expect(vaultResolver.Query.vault(null, {
          address: '0x123...',
          orgId: 'org123',
          adminAddress: '0xwrongadmin'
        })).rejects.toThrow('Access denied: admin does not belong to organization.');
      });

      it('should allow access when admin belongs to org', async () => {
        const mockOrgA = { id: 'orgA', admin_address: '0xadminA' };
        const mockVault = { id: '1', address: '0xvaultA', org_id: 'orgA', beneficiaries: [], subSchedules: [] };
        
        models.Vault.findOne.mockResolvedValue(mockVault);
        const result = await vaultResolver.Query.vault(null, { address: '0xvaultA', orgId: mockOrgA.id, adminAddress: mockOrgA.admin_address });
        expect(result).toEqual(mockVault);
      });
    });

    describe('Query.vaults', () => {
      it('should fetch vaults with pagination', async () => {
        const mockVaults = [
          { id: '1', address: '0x123...' },
          { id: '2', address: '0x456...' }
        ];

        models.Vault.findAll.mockResolvedValue(mockVaults);

        const result = await vaultResolver.Query.vaults(null, { 
          orgId: 'org123',
          adminAddress: '0xadmin...',
          first: 10, 
          after: '0' 
        });

        expect(models.Vault.findAll).toHaveBeenCalledWith({
          where: { org_id: 'org123' },
          include: [
            { model: models.Beneficiary, as: 'beneficiaries' },
            { model: models.SubSchedule, as: 'subSchedules' }
          ],
          limit: 10,
          offset: 0,
          order: [['created_at', 'DESC']]
        });
        expect(result).toEqual(mockVaults);
      });
    });

    describe('Mutation.createVault', () => {
      it('should create a new vault', async () => {
        const mockVault = {
          id: '1',
          address: '0x123...',
          name: 'Test Vault',
          token_address: '0xabc...',
          owner_address: '0xowner...',
          total_amount: '1000'
        };

        models.Vault.create.mockResolvedValue(mockVault);

        const input = {
          address: '0x123...',
          name: 'Test Vault',
          tokenAddress: '0xabc...',
          ownerAddress: '0xowner...',
          totalAmount: '1000'
        };

        const result = await vaultResolver.Mutation.createVault(null, { input });

        expect(models.Vault.create).toHaveBeenCalledWith({
          address: '0x123...',
          name: 'Test Vault',
          token_address: '0xabc...',
          owner_address: '0xowner...',
          total_amount: '1000'
        });
        expect(result).toEqual(mockVault);
      });
    });
  });

  describe('User Resolver', () => {
    describe('Query.beneficiary', () => {
      it('should fetch a beneficiary', async () => {
        const mockVault = { id: '1', address: '0x123...' };
        const mockBeneficiary = {
          id: '1',
          vault_id: '1',
          address: '0xbeneficiary...',
          total_allocated: '500',
          total_withdrawn: '100'
        };

        models.Vault.findOne.mockResolvedValue(mockVault);
        models.Beneficiary.findOne.mockResolvedValue(mockBeneficiary);

        const result = await userResolver.Query.beneficiary(null, {
          vaultAddress: '0x123...',
          beneficiaryAddress: '0xbeneficiary...'
        });

        expect(models.Vault.findOne).toHaveBeenCalledWith({
          where: { address: '0x123...' }
        });
        expect(models.Beneficiary.findOne).toHaveBeenCalledWith({
          where: {
            vault_id: '1',
            address: '0xbeneficiary...'
          },
          include: [{ model: models.Vault, as: 'vault' }]
        });
        expect(result).toEqual(mockBeneficiary);
      });
    });

    describe('Query.claims', () => {
      it('should fetch claims with filters', async () => {
        const mockClaims = [
          {
            id: '1',
            user_address: '0xuser...',
            token_address: '0xtoken...',
            amount_claimed: '100'
          }
        ];

        models.ClaimsHistory.findAll.mockResolvedValue(mockClaims);

        const result = await userResolver.Query.claims(null, {
          userAddress: '0xuser...',
          tokenAddress: '0xtoken...',
          first: 10,
          after: '0'
        });

        expect(models.ClaimsHistory.findAll).toHaveBeenCalledWith({
          where: {
            user_address: '0xuser...',
            token_address: '0xtoken...'
          },
          limit: 10,
          offset: 0,
          order: [['claim_timestamp', 'DESC']]
        });
        expect(result).toEqual(mockClaims);
      });
    });

    describe('Mutation.withdraw', () => {
      it('should process withdrawal successfully', async () => {
        const now = new Date();
        const past = new Date(now.getTime() - 86400 * 10 * 1000); // 10 days ago
        const end = new Date(now.getTime() - 86400 * 5 * 1000); // 5 days ago (already ended)

        const mockSubSchedule = {
          id: '1',
          vault_id: '1',
          top_up_amount: '1000',
          top_up_timestamp: past,
          start_timestamp: past,
          end_timestamp: end,
          cliff_duration: 0,
          vesting_duration: 86400 * 5
        };

        const mockVault = { id: '1', address: '0x123...' };
        const mockBeneficiary = {
          id: '1',
          vault_id: '1',
          address: '0xbeneficiary...',
          total_allocated: '500',
          total_withdrawn: '100',
          update: jest.fn().mockResolvedValue({})
        };

        models.Vault.findOne.mockResolvedValue(mockVault);
        models.Beneficiary.findOne.mockResolvedValue(mockBeneficiary);
        models.SubSchedule.findAll.mockResolvedValue([mockSubSchedule]);

        const input = {
          vaultAddress: '0x123...',
          beneficiaryAddress: '0xbeneficiary...',
          amount: '50',
          transactionHash: '0xtx...',
          blockNumber: '12345'
        };

        const result = await userResolver.Mutation.withdraw(null, { input });

        expect(mockBeneficiary.update).toHaveBeenCalledWith({
          total_withdrawn: '150'
        });
        expect(result).toBeDefined();
      });
    });
  });

  describe('Proof Resolver', () => {
    describe('Query.health', () => {
      it('should return health status', () => {
        const result = proofResolver.Query.health();
        expect(result).toBe('GraphQL API is healthy');
      });
    });

    describe('Mutation.revokeAccess', () => {
      it('should create audit log for access revocation', async () => {
        const input = {
          adminAddress: '0xadmin...',
          targetVault: '0x123...',
          reason: 'Security violation'
        };

        const result = await proofResolver.Mutation.revokeAccess(null, { input });

        expect(result).toEqual({
          id: expect.stringMatching(/^audit-\d+$/),
          adminAddress: '0xadmin...',
          action: 'REVOKE_ACCESS',
          targetVault: '0x123...',
          details: 'Security violation',
          timestamp: expect.any(Date),
          transactionHash: null
        });
      });
    });
  });
});

describe('Resolver Error Handling', () => {
  it('should handle database errors gracefully', async () => {
    models.Vault.findOne.mockRejectedValue(new Error('Database connection failed'));

    await expect(vaultResolver.Query.vault(null, { address: '0x123...' }))
      .rejects.toThrow('Failed to fetch vault: Database connection failed');
  });

  it('should handle validation errors', async () => {
    const mockVault = { id: '1', address: '0x123...' };
    const mockBeneficiary = {
      id: '1',
      total_allocated: '500',
      total_withdrawn: '100'
    };

    models.Vault.findOne.mockResolvedValue(mockVault);
    models.Beneficiary.findOne.mockResolvedValue(mockBeneficiary);

    const input = {
      vaultAddress: '0x123...',
      beneficiaryAddress: '0xbeneficiary...',
      amount: '1000', // More than available
      transactionHash: '0xtx...',
      blockNumber: '12345'
    };

    await expect(userResolver.Mutation.withdraw(null, { input }))
      .rejects.toThrow('Insufficient withdrawable amount');
  });
});
