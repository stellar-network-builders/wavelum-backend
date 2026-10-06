const { sequelize } = require('../database/connection');
const contractUpgradeService = require('./contractUpgradeService');
const wasmHashVerificationService = require('./wasmHashVerificationService');
const { 
  ContractUpgradeProposal, 
  ContractUpgradeSignature, 
  ContractUpgradeAuditLog,
  Vault,
  CertifiedBuild,
  MultiSigConfig
} = require('../models');

describe('ContractUpgradeService', () => {
  let testVault;
  let testCertifiedBuild;
  let adminAddress = 'GTESTADMIN123456789ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHI';
  let signer1 = 'GTESTSIGNER1123456789ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHI';
  let signer2 = 'GTESTSIGNER2123456789ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHI';
  let signer3 = 'GTESTSIGNER3123456789ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHI';

  beforeAll(async () => {
    // Set up test database
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up database
    await ContractUpgradeAuditLog.destroy({ where: {} });
    await ContractUpgradeSignature.destroy({ where: {} });
    await ContractUpgradeProposal.destroy({ where: {} });
    await MultiSigConfig.destroy({ where: {} });
    await CertifiedBuild.destroy({ where: {} });
    await Vault.destroy({ where: {} });

    // Create test vault
    testVault = await Vault.create({
      address: 'GTESTVAULT123456789ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHI',
      token_address: 'GTESTTOKEN123456789ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHI',
      owner_address: adminAddress,
      total_amount: '1000000',
      is_active: true
    });

    // Create test certified build
    testCertifiedBuild = await CertifiedBuild.create({
      build_id: 'test-build-001',
      wasm_hash: 'a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef1234567890',
      version: '1.1.0',
      commit_hash: 'abc123def456',
      build_timestamp: new Date(),
      builder_address: adminAddress,
      verification_signature: 'test_signature',
      build_metadata: {
        contract_type: 'vesting_vault',
        immutable_terms_compatible: true,
        compatibility_version: '1.1.0'
      },
      security_audit_passed: true,
      audit_report_url: 'https://audit.example.com/report',
      immutable_terms_compatible: true,
      compatibility_version: '1.1.0'
    });
  });

  describe('createUpgradeProposal', () => {
    it('should create a valid upgrade proposal', async () => {
      const proposalData = {
        vault_address: testVault.address,
        proposed_wasm_hash: testCertifiedBuild.wasm_hash,
        upgrade_reason: 'Security patch and performance improvements',
        signers: [signer1, signer2, signer3],
        required_signatures: 2
      };

      // Mock the verification service
      jest.spyOn(wasmHashVerificationService, 'verifyWasmHash').mockResolvedValue({
        valid: true,
        certified_build_id: testCertifiedBuild.build_id,
        verification_details: {
          hash_checked: testCertifiedBuild.wasm_hash,
          certified_build_id: testCertifiedBuild.build_id
        }
      });

      jest.spyOn(contractUpgradeService, 'getCurrentWasmHash').mockResolvedValue('current_hash_placeholder');
      jest.spyOn(contractUpgradeService, 'calculateImmutableTermsHash').mockResolvedValue('immutable_terms_hash');
      jest.spyOn(contractUpgradeService, 'checkAdminPermission').mockResolvedValue(true);

      const proposal = await contractUpgradeService.createUpgradeProposal(proposalData, adminAddress);

      expect(proposal).toBeDefined();
      expect(proposal.vault_address).toBe(testVault.address);
      expect(proposal.proposed_wasm_hash).toBe(testCertifiedBuild.wasm_hash);
      expect(proposal.status).toBe('verified');
      expect(proposal.required_signatures).toBe(2);
      expect(proposal.total_signers).toBe(3);
      expect(proposal.signers).toEqual([signer1, signer2, signer3]);

      // Check that audit log was created
      const auditLogs = await ContractUpgradeAuditLog.findAll({
        where: { proposal_id: proposal.id }
      });
      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('proposal_created');
    });

    it('should reject proposal for non-existent vault', async () => {
      const proposalData = {
        vault_address: 'GNONEXISTENT123456789ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHI',
        proposed_wasm_hash: testCertifiedBuild.wasm_hash,
        upgrade_reason: 'Test upgrade',
        signers: [signer1, signer2],
        required_signatures: 2
      };

      await expect(
        contractUpgradeService.createUpgradeProposal(proposalData, adminAddress)
      ).rejects.toThrow('Vault not found or inactive');
    });

    it('should reject proposal without admin permission', async () => {
      const unauthorizedAdmin = 'GUNAUTHORIZED123456789ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHI';
      
      jest.spyOn(contractUpgradeService, 'checkAdminPermission').mockResolvedValue(false);

      const proposalData = {
        vault_address: testVault.address,
        proposed_wasm_hash: testCertifiedBuild.wasm_hash,
        upgrade_reason: 'Test upgrade',
        signers: [signer1, signer2],
        required_signatures: 2
      };

      await expect(
        contractUpgradeService.createUpgradeProposal(proposalData, unauthorizedAdmin)
      ).rejects.toThrow('Admin does not have permission for this vault');
    });

    it('should reject proposal with invalid WASM hash', async () => {
      jest.spyOn(wasmHashVerificationService, 'verifyWasmHash').mockResolvedValue({
        valid: false,
        error: 'WASM hash not found in certified builds'
      });

      const proposalData = {
        vault_address: testVault.address,
        proposed_wasm_hash: 'invalid_hash_1234567890abcdef',
        upgrade_reason: 'Test upgrade',
        signers: [signer1, signer2],
        required_signatures: 2
      };

      await expect(
        contractUpgradeService.createUpgradeProposal(proposalData, adminAddress)
      ).rejects.toThrow('WASM hash verification failed');
    });
  });

  describe('approveProposal', () => {
    let testProposal;

    beforeEach(async () => {
      // Create a test proposal
      jest.spyOn(wasmHashVerificationService, 'verifyWasmHash').mockResolvedValue({
        valid: true,
        certified_build_id: testCertifiedBuild.build_id
      });
      jest.spyOn(contractUpgradeService, 'getCurrentWasmHash').mockResolvedValue('current_hash');
      jest.spyOn(contractUpgradeService, 'calculateImmutableTermsHash').mockResolvedValue('immutable_hash');
      jest.spyOn(contractUpgradeService, 'checkAdminPermission').mockResolvedValue(true);

      testProposal = await contractUpgradeService.createUpgradeProposal({
        vault_address: testVault.address,
        proposed_wasm_hash: testCertifiedBuild.wasm_hash,
        upgrade_reason: 'Test upgrade',
        signers: [signer1, signer2, signer3],
        required_signatures: 2
      }, adminAddress);
    });

    it('should accept valid approval signature', async () => {
      jest.spyOn(contractUpgradeService, 'validateSignature').mockResolvedValue(true);

      const result = await contractUpgradeService.approveProposal(
        testProposal.id,
        signer1,
        'valid_signature_123',
        'approve',
        'Looks good to me'
      );

      expect(result.success).toBe(true);
      expect(result.proposal_status).toBe('pending_approval');
      expect(result.approvals).toBe(1);
      expect(result.rejections).toBe(0);

      // Check signature was recorded
      const signature = await ContractUpgradeSignature.findOne({
        where: { proposal_id: testProposal.id, signer_address: signer1 }
      });
      expect(signature).toBeDefined();
      expect(signature.decision).toBe('approve');
      expect(signature.signing_reason).toBe('Looks good to me');
    });

    it('should reject approval from unauthorized signer', async () => {
      const unauthorizedSigner = 'GUNAUTHORIZED123456789ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHI';

      await expect(
        contractUpgradeService.approveProposal(
          testProposal.id,
          unauthorizedSigner,
          'signature_123',
          'approve'
        )
      ).rejects.toThrow('Signer is not authorized for this proposal');
    });

    it('should reject duplicate signatures', async () => {
      jest.spyOn(contractUpgradeService, 'validateSignature').mockResolvedValue(true);

      // First signature
      await contractUpgradeService.approveProposal(
        testProposal.id,
        signer1,
        'signature_123',
        'approve'
      );

      // Second signature from same signer
      await expect(
        contractUpgradeService.approveProposal(
          testProposal.id,
          signer1,
          'signature_456',
          'approve'
        )
      ).rejects.toThrow('Signer has already voted on this proposal');
    });

    it('should approve proposal when threshold is reached', async () => {
      jest.spyOn(contractUpgradeService, 'validateSignature').mockResolvedValue(true);

      // First approval
      await contractUpgradeService.approveProposal(
        testProposal.id,
        signer1,
        'signature_123',
        'approve'
      );

      // Second approval (reaches threshold)
      const result = await contractUpgradeService.approveProposal(
        testProposal.id,
        signer2,
        'signature_456',
        'approve'
      );

      expect(result.success).toBe(true);
      expect(result.proposal_status).toBe('approved');
      expect(result.message).toBe('Required approvals reached');
    });

    it('should reject proposal when rejection threshold is reached', async () => {
      jest.spyOn(contractUpgradeService, 'validateSignature').mockResolvedValue(true);

      // First rejection
      await contractUpgradeService.approveProposal(
        testProposal.id,
        signer1,
        'signature_123',
        'reject',
        'Security concerns'
      );

      // Second rejection (reaches threshold)
      const result = await contractUpgradeService.approveProposal(
        testProposal.id,
        signer2,
        'signature_456',
        'reject',
        'Not ready for upgrade'
      );

      expect(result.success).toBe(true);
      expect(result.proposal_status).toBe('rejected');
      expect(result.message).toBe('Required rejections reached');
    });
  });

  describe('executeUpgrade', () => {
    let approvedProposal;

    beforeEach(async () => {
      // Create and approve a proposal
      jest.spyOn(wasmHashVerificationService, 'verifyWasmHash').mockResolvedValue({
        valid: true,
        certified_build_id: testCertifiedBuild.build_id
      });
      jest.spyOn(contractUpgradeService, 'getCurrentWasmHash').mockResolvedValue('current_hash');
      jest.spyOn(contractUpgradeService, 'calculateImmutableTermsHash').mockResolvedValue('immutable_hash');
      jest.spyOn(contractUpgradeService, 'checkAdminPermission').mockResolvedValue(true);
      jest.spyOn(contractUpgradeService, 'validateSignature').mockResolvedValue(true);

      const proposal = await contractUpgradeService.createUpgradeProposal({
        vault_address: testVault.address,
        proposed_wasm_hash: testCertifiedBuild.wasm_hash,
        upgrade_reason: 'Test upgrade',
        signers: [signer1, signer2],
        required_signatures: 2
      }, adminAddress);

      // Approve the proposal
      await contractUpgradeService.approveProposal(proposal.id, signer1, 'sig1', 'approve');
      await contractUpgradeService.approveProposal(proposal.id, signer2, 'sig2', 'approve');

      approvedProposal = await ContractUpgradeProposal.findByPk(proposal.id);
    });

    it('should execute approved upgrade successfully', async () => {
      jest.spyOn(contractUpgradeService, 'executeBlockchainUpgrade').mockResolvedValue({
        success: true,
        tx_hash: '0x1234567890abcdef',
        block_number: 12345,
        gas_used: '1000000'
      });
      jest.spyOn(contractUpgradeService, 'calculateImmutableTermsHash').mockResolvedValue('immutable_hash');

      const result = await contractUpgradeService.executeUpgrade(
        approvedProposal.id,
        adminAddress
      );

      expect(result.success).toBe(true);
      expect(result.transaction_hash).toBe('0x1234567890abcdef');

      // Check proposal status was updated
      const updatedProposal = await ContractUpgradeProposal.findByPk(approvedProposal.id);
      expect(updatedProposal.status).toBe('executed');
      expect(updatedProposal.execution_tx_hash).toBe('0x1234567890abcdef');
      expect(updatedProposal.executed_at).toBeDefined();
    });

    it('should reject execution of non-approved proposal', async () => {
      const pendingProposal = await contractUpgradeService.createUpgradeProposal({
        vault_address: testVault.address,
        proposed_wasm_hash: testCertifiedBuild.wasm_hash,
        upgrade_reason: 'Test upgrade',
        signers: [signer1, signer2],
        required_signatures: 2
      }, adminAddress);

      await expect(
        contractUpgradeService.executeUpgrade(pendingProposal.id, adminAddress)
      ).rejects.toThrow('Proposal is not approved');
    });

    it('should reject execution without executor permission', async () => {
      const unauthorizedExecutor = 'GUNAUTHORIZED123456789ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHI';
      jest.spyOn(contractUpgradeService, 'checkAdminPermission').mockResolvedValue(false);

      await expect(
        contractUpgradeService.executeUpgrade(approvedProposal.id, unauthorizedExecutor)
      ).rejects.toThrow('Executor does not have permission for this vault');
    });

    it('should reject execution if immutable terms changed', async () => {
      jest.spyOn(contractUpgradeService, 'calculateImmutableTermsHash').mockResolvedValue('different_hash');

      await expect(
        contractUpgradeService.executeUpgrade(approvedProposal.id, adminAddress)
      ).rejects.toThrow('Immutable terms have changed since proposal creation');
    });
  });

  describe('getProposalDetails', () => {
    it('should return complete proposal details', async () => {
      jest.spyOn(wasmHashVerificationService, 'verifyWasmHash').mockResolvedValue({
        valid: true,
        certified_build_id: testCertifiedBuild.build_id
      });
      jest.spyOn(contractUpgradeService, 'getCurrentWasmHash').mockResolvedValue('current_hash');
      jest.spyOn(contractUpgradeService, 'calculateImmutableTermsHash').mockResolvedValue('immutable_hash');
      jest.spyOn(contractUpgradeService, 'checkAdminPermission').mockResolvedValue(true);

      const proposal = await contractUpgradeService.createUpgradeProposal({
        vault_address: testVault.address,
        proposed_wasm_hash: testCertifiedBuild.wasm_hash,
        upgrade_reason: 'Test upgrade',
        signers: [signer1, signer2],
        required_signatures: 2
      }, adminAddress);

      const details = await contractUpgradeService.getProposalDetails(proposal.id);

      expect(details).toBeDefined();
      expect(details.id).toBe(proposal.id);
      expect(details.vault_address).toBe(testVault.address);
      expect(details.signatures).toBeDefined();
      expect(details.auditLogs).toBeDefined();
    });

    it('should throw error for non-existent proposal', async () => {
      await expect(
        contractUpgradeService.getProposalDetails('non-existent-id')
      ).rejects.toThrow('Proposal not found');
    });
  });

  describe('getVaultProposals', () => {
    beforeEach(async () => {
      jest.spyOn(wasmHashVerificationService, 'verifyWasmHash').mockResolvedValue({
        valid: true,
        certified_build_id: testCertifiedBuild.build_id
      });
      jest.spyOn(contractUpgradeService, 'getCurrentWasmHash').mockResolvedValue('current_hash');
      jest.spyOn(contractUpgradeService, 'calculateImmutableTermsHash').mockResolvedValue('immutable_hash');
      jest.spyOn(contractUpgradeService, 'checkAdminPermission').mockResolvedValue(true);

      // Create multiple proposals
      await contractUpgradeService.createUpgradeProposal({
        vault_address: testVault.address,
        proposed_wasm_hash: testCertifiedBuild.wasm_hash,
        upgrade_reason: 'First upgrade',
        signers: [signer1, signer2],
        required_signatures: 2
      }, adminAddress);

      await contractUpgradeService.createUpgradeProposal({
        vault_address: testVault.address,
        proposed_wasm_hash: testCertifiedBuild.wasm_hash,
        upgrade_reason: 'Second upgrade',
        signers: [signer1, signer2],
        required_signatures: 2
      }, adminAddress);
    });

    it('should return all proposals for vault', async () => {
      const proposals = await contractUpgradeService.getVaultProposals(testVault.address);

      expect(proposals).toHaveLength(2);
      expect(proposals[0].vault_address).toBe(testVault.address);
      expect(proposals[1].vault_address).toBe(testVault.address);
    });

    it('should filter proposals by status', async () => {
      const proposals = await contractUpgradeService.getVaultProposals(testVault.address, {
        status: 'verified'
      });

      expect(proposals).toHaveLength(2);
      proposals.forEach(proposal => {
        expect(proposal.status).toBe('verified');
      });
    });
  });
});
