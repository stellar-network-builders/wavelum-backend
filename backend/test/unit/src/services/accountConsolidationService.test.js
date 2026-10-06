'use strict';

const { sequelize } = require('../database/connection');
const accountConsolidationService = require('./accountConsolidationService');

describe('AccountConsolidationService', () => {
  let mockVault, mockBeneficiary, mockSubSchedule;

  beforeEach(() => {
    // Mock the models
    mockVault = {
      id: 'vault-1',
      address: 'VAULT_ADDRESS_1',
      name: 'Test Vault',
      token_address: 'TOKEN_ADDRESS',
      owner_address: 'OWNER_ADDRESS',
      total_amount: '1000',
      is_blacklisted: false,
      org_id: 'org-1',
      tag: 'Team'
    };

    mockBeneficiary = {
      id: 'beneficiary-1',
      vault_id: 'vault-1',
      address: 'BENEFICIARY_ADDRESS',
      total_allocated: '500',
      total_withdrawn: '100',
      email: 'test@example.com',
      email_valid: true
    };

    mockSubSchedule = {
      id: 'schedule-1',
      vault_id: 'vault-1',
      top_up_amount: '1000',
      cliff_duration: 86400, // 1 day
      cliff_date: new Date('2023-01-02'),
      vesting_start_date: new Date('2023-01-02'),
      vesting_duration: 31536000, // 1 year
      start_timestamp: new Date('2023-01-02'),
      end_timestamp: new Date('2024-01-02'),
      transaction_hash: 'TX_HASH',
      amount_withdrawn: '0',
      amount_released: '0',
      is_active: true
    };
  });

  describe('getConsolidatedView', () => {
    let findAllStub;

    beforeEach(() => {
      findAllStub = sinon.stub();
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should return consolidated view for beneficiary with multiple vaults', async () => {
      // Arrange
      const mockBeneficiaries = [
        {
          ...mockBeneficiary,
          vault: {
            ...mockVault,
            subSchedules: [mockSubSchedule]
          }
        },
        {
          ...mockBeneficiary,
          id: 'beneficiary-2',
          vault: {
            ...mockVault,
            id: 'vault-2',
            address: 'VAULT_ADDRESS_2',
            subSchedules: [{
              ...mockSubSchedule,
              id: 'schedule-2',
              vault_id: 'vault-2',
              cliff_date: new Date('2023-02-01'),
              vesting_start_date: new Date('2023-02-01'),
              end_timestamp: new Date('2024-02-01')
            }]
          }
        }
      ];

      findAllStub.resolves(mockBeneficiaries);
      
      // Mock the Beneficiary model
      const { Beneficiary } = require('../models');
      sinon.stub(Beneficiary, 'findAll').callsFake(findAllStub);

      // Act
      const result = await accountConsolidationService.getConsolidatedView('BENEFICIARY_ADDRESS');

      // Assert
      expect(result.beneficiary_address).to.equal('BENEFICIARY_ADDRESS');
      expect(result.total_vaults).to.equal(2);
      expect(result.total_allocated).to.equal('1000'); // 500 + 500
      expect(result.total_withdrawn).to.equal('200'); // 100 + 100
      expect(result.vaults).to.have.length(2);
      expect(result.consolidation_summary.original_vesting_tracks).to.equal(2);
      expect(result.consolidation_summary.consolidated_tracks).to.equal(2);
    });

    it('should return empty result for beneficiary with no vaults', async () => {
      // Arrange
      findAllStub.resolves([]);
      
      const { Beneficiary } = require('../models');
      sinon.stub(Beneficiary, 'findAll').callsFake(findAllStub);

      // Act
      const result = await accountConsolidationService.getConsolidatedView('UNKNOWN_ADDRESS');

      // Assert
      expect(result.beneficiary_address).to.equal('UNKNOWN_ADDRESS');
      expect(result.total_vaults).to.equal(0);
      expect(result.total_allocated).to.equal('0');
      expect(result.total_withdrawn).to.equal('0');
      expect(result.vaults).to.have.length(0);
    });

    it('should filter by organization when provided', async () => {
      // Arrange
      const mockBeneficiaries = [
        {
          ...mockBeneficiary,
          vault: {
            ...mockVault,
            org_id: 'target-org',
            subSchedules: [mockSubSchedule]
          }
        }
      ];

      findAllStub.resolves(mockBeneficiaries);
      
      const { Beneficiary } = require('../models');
      sinon.stub(Beneficiary, 'findAll').callsFake(findAllStub);

      // Act
      const result = await accountConsolidationService.getConsolidatedView('BENEFICIARY_ADDRESS', {
        organizationId: 'target-org'
      });

      // Assert
      expect(Beneficiary.findAll).to.have.been.calledWith(sinon.match({
        include: [sinon.match({
          model: sinon.match.any,
          where: { org_id: 'target-org' }
        })]
      }));
      expect(result.total_vaults).to.equal(1);
    });

    it('should skip blacklisted vaults', async () => {
      // Arrange
      const mockBeneficiaries = [
        {
          ...mockBeneficiary,
          vault: {
            ...mockVault,
            is_blacklisted: true,
            subSchedules: [mockSubSchedule]
          }
        },
        {
          ...mockBeneficiary,
          id: 'beneficiary-2',
          vault: {
            ...mockVault,
            id: 'vault-2',
            is_blacklisted: false,
            subSchedules: [mockSubSchedule]
          }
        }
      ];

      findAllStub.resolves(mockBeneficiaries);
      
      const { Beneficiary } = require('../models');
      sinon.stub(Beneficiary, 'findAll').callsFake(findAllStub);

      // Act
      const result = await accountConsolidationService.getConsolidatedView('BENEFICIARY_ADDRESS');

      // Assert
      expect(result.total_vaults).to.equal(1); // Only non-blacklisted vault
      expect(result.vaults[0].vault_address).to.equal('VAULT_ADDRESS_2');
    });

    it('should calculate weighted average dates correctly', async () => {
      // Arrange
      const mockBeneficiaries = [
        {
          ...mockBeneficiary,
          total_allocated: '300',
          vault: {
            ...mockVault,
            subSchedules: [{
              ...mockSubSchedule,
              top_up_amount: '600',
              cliff_date: new Date('2023-01-01'),
              end_timestamp: new Date('2024-01-01')
            }]
          }
        },
        {
          ...mockBeneficiary,
          id: 'beneficiary-2',
          total_allocated: '700',
          vault: {
            ...mockVault,
            id: 'vault-2',
            subSchedules: [{
              ...mockSubSchedule,
              id: 'schedule-2',
              vault_id: 'vault-2',
              top_up_amount: '1400',
              cliff_date: new Date('2023-03-01'),
              end_timestamp: new Date('2024-03-01')
            }]
          }
        }
      ];

      findAllStub.resolves(mockBeneficiaries);
      
      const { Beneficiary } = require('../models');
      sinon.stub(Beneficiary, 'findAll').callsFake(findAllStub);

      // Act
      const result = await accountConsolidationService.getConsolidatedView('BENEFICIARY_ADDRESS');

      // Assert
      expect(result.weighted_average_cliff_date).to.not.be.null;
      expect(result.weighted_average_end_date).to.not.be.null;
      
      // Weighted average should be closer to the second date (700 vs 300 allocation)
      const cliffDate = new Date(result.weighted_average_cliff_date);
      const expectedCliffDate = new Date('2023-02-12'); // Approximate weighted average
      expect(Math.abs(cliffDate.getTime() - expectedCliffDate.getTime())).to.be.lessThan(86400000); // Within 1 day
    });
  });

  describe('mergeBeneficiaryAddresses', () => {
    let transactionStub, findAllStub, findOneStub, createStub, destroyStub;

    beforeEach(() => {
      transactionStub = {
        commit: sinon.stub().resolves(),
        rollback: sinon.stub().resolves()
      };
      
      findAllStub = sinon.stub();
      findOneStub = sinon.stub();
      createStub = sinon.stub();
      destroyStub = sinon.stub();

      sinon.stub(sequelize, 'transaction').resolves(transactionStub);
    });

    afterEach(() => {
      sinon.restore();
    });

    it('should merge beneficiary addresses successfully', async () => {
      // Arrange
      const primaryBeneficiaries = [mockBeneficiary];
      const beneficiariesToMerge = [
        {
          ...mockBeneficiary,
          id: 'beneficiary-to-merge-1',
          total_allocated: '200',
          total_withdrawn: '50',
          vault: mockVault
        }
      ];

      findAllStub.onFirstCall().resolves(primaryBeneficiaries);
      findAllStub.onSecondCall().resolves(beneficiariesToMerge);
      findOneStub.resolves(null); // No existing primary beneficiary for this vault
      createStub.resolves({});

      const { Beneficiary } = require('../models');
      sinon.stub(Beneficiary, 'findAll').callsFake((...args) => {
        if (args[0].where.address === 'PRIMARY_ADDRESS') {
          return findAllStub.onFirstCall()(args);
        } else {
          return findAllStub.onSecondCall()(args);
        }
      });
      Beneficiary.findOne = findOneStub;
      Beneficiary.create = createStub;

      // Act
      const result = await accountConsolidationService.mergeBeneficiaryAddresses(
        'PRIMARY_ADDRESS',
        ['ADDRESS_TO_MERGE'],
        'ADMIN_ADDRESS'
      );

      // Assert
      expect(result.primary_address).to.equal('PRIMARY_ADDRESS');
      expect(result.merged_addresses).to.include('ADDRESS_TO_MERGE');
      expect(result.vaults_updated).to.equal(1);
      expect(result.total_allocation_transferred).to.equal('200');
      expect(result.total_withdrawal_transferred).to.equal('50');
      expect(transactionStub.commit).to.have.been.called;
    });

    it('should merge into existing primary beneficiary record', async () => {
      // Arrange
      const primaryBeneficiaries = [mockBeneficiary];
      const beneficiariesToMerge = [
        {
          ...mockBeneficiary,
          id: 'beneficiary-to-merge-1',
          total_allocated: '200',
          total_withdrawn: '50',
          vault: mockVault
        }
      ];
      const existingPrimary = {
        ...mockBeneficiary,
        total_allocated: '300',
        total_withdrawn: '100',
        update: sinon.stub().resolves()
      };

      findAllStub.onFirstCall().resolves(primaryBeneficiaries);
      findAllStub.onSecondCall().resolves(beneficiariesToMerge);
      findOneStub.resolves(existingPrimary);

      const { Beneficiary } = require('../models');
      sinon.stub(Beneficiary, 'findAll').callsFake((...args) => {
        if (args[0].where.address === 'PRIMARY_ADDRESS') {
          return findAllStub.onFirstCall()(args);
        } else {
          return findAllStub.onSecondCall()(args);
        }
      });
      Beneficiary.findOne = findOneStub;

      // Act
      const result = await accountConsolidationService.mergeBeneficiaryAddresses(
        'PRIMARY_ADDRESS',
        ['ADDRESS_TO_MERGE'],
        'ADMIN_ADDRESS'
      );

      // Assert
      expect(existingPrimary.update).to.have.been.calledWith({
        total_allocated: '500', // 300 + 200
        total_withdrawn: '150' // 100 + 50
      });
      expect(result.total_allocation_transferred).to.equal('200');
      expect(result.total_withdrawal_transferred).to.equal('50');
    });

    it('should throw error if primary address not found', async () => {
      // Arrange
      findAllStub.resolves([]);

      const { Beneficiary } = require('../models');
      sinon.stub(Beneficiary, 'findAll').callsFake(findAllStub);

      // Act & Assert
      try {
        await accountConsolidationService.mergeBeneficiaryAddresses(
          'UNKNOWN_PRIMARY',
          ['ADDRESS_TO_MERGE'],
          'ADMIN_ADDRESS'
        );
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Primary beneficiary address not found');
        expect(transactionStub.rollback).to.have.been.called;
      }
    });

    it('should handle multiple addresses to merge', async () => {
      // Arrange
      const primaryBeneficiaries = [mockBeneficiary];
      const beneficiariesToMerge = [
        {
          ...mockBeneficiary,
          id: 'beneficiary-to-merge-1',
          total_allocated: '200',
          total_withdrawn: '50',
          vault: mockVault
        },
        {
          ...mockBeneficiary,
          id: 'beneficiary-to-merge-2',
          total_allocated: '300',
          total_withdrawn: '75',
          vault: mockVault
        }
      ];

      findAllStub.onFirstCall().resolves(primaryBeneficiaries);
      findAllStub.onSecondCall().resolves(beneficiariesToMerge);
      findOneStub.resolves(null);
      createStub.resolves({});

      const { Beneficiary } = require('../models');
      sinon.stub(Beneficiary, 'findAll').callsFake((...args) => {
        if (args[0].where.address === 'PRIMARY_ADDRESS') {
          return findAllStub.onFirstCall()(args);
        } else {
          return findAllStub.onSecondCall()(args);
        }
      });
      Beneficiary.findOne = findOneStub;
      Beneficiary.create = createStub;

      // Act
      const result = await accountConsolidationService.mergeBeneficiaryAddresses(
        'PRIMARY_ADDRESS',
        ['ADDRESS_TO_MERGE_1', 'ADDRESS_TO_MERGE_2'],
        'ADMIN_ADDRESS'
      );

      // Assert
      expect(result.merged_addresses).to.have.length(2);
      expect(result.total_allocation_transferred).to.equal('500'); // 200 + 300
      expect(result.total_withdrawal_transferred).to.equal('125'); // 50 + 75
    });
  });

  describe('_calculateVaultWeightedDates', () => {
    it('should calculate weighted average dates correctly', () => {
      // Arrange
      const subSchedules = [
        {
          top_up_amount: '1000',
          cliff_date: new Date('2023-01-01'),
          end_timestamp: new Date('2024-01-01'),
          vesting_duration: 31536000
        },
        {
          top_up_amount: '2000',
          cliff_date: new Date('2023-03-01'),
          end_timestamp: new Date('2024-03-01'),
          vesting_duration: 31622400
        }
      ];

      // Act
      const result = accountConsolidationService._calculateVaultWeightedDates(
        subSchedules,
        3000
      );

      // Assert
      expect(result.cliffDate).to.be.instanceOf(Date);
      expect(result.endDate).to.be.instanceOf(Date);
      expect(result.duration).to.be.greaterThan(0);
      
      // Weighted average should be closer to the second date (higher amount)
      const expectedCliffDate = new Date('2023-02-01'); // Weighted average
      expect(Math.abs(result.cliffDate.getTime() - expectedCliffDate.getTime())).to.be.lessThan(86400000);
    });

    it('should handle empty sub-schedules', () => {
      // Act
      const result = accountConsolidationService._calculateVaultWeightedDates([], 1000);

      // Assert
      expect(result.cliffDate).to.be.null;
      expect(result.endDate).to.be.null;
      expect(result.duration).to.equal(0);
    });

    it('should handle zero allocation', () => {
      // Arrange
      const subSchedules = [mockSubSchedule];

      // Act
      const result = accountConsolidationService._calculateVaultWeightedDates(subSchedules, 0);

      // Assert
      expect(result.cliffDate).to.be.null;
      expect(result.endDate).to.be.null;
      expect(result.duration).to.equal(0);
    });
  });
});
