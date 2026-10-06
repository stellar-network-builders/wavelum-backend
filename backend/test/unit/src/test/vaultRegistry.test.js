const request = require('supertest');
const { app } = require('../index');
const { sequelize } = require('../database/connection');
const { VaultRegistry, IndexerState } = require('../models');

describe('Vault Registry API', () => {
  let server;

  beforeAll(async () => {
    // Start the server for testing
    server = app.listen(0); // Use random port
  });

  afterAll(async () => {
    if (server) {
      await server.close();
    }
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await VaultRegistry.destroy({ where: {} });
    await IndexerState.destroy({ where: {} });
  });

  describe('GET /api/registry/vaults/by-creator/:creatorAddress', () => {
    it('should return empty array for creator with no vaults', async () => {
      const response = await request(app)
        .get('/api/registry/vaults/by-creator/GD1234567890abcdef')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.vaults).toEqual([]);
      expect(response.body.data.pagination.total).toBe(0);
    });

    it('should return vaults for a creator', async () => {
      // Create test vault registry entries
      await VaultRegistry.create({
        contract_id: 'CA1234567890abcdef',
        project_name: 'Test Project',
        creator_address: 'GD1234567890abcdef',
        deployment_ledger: 12345,
        vault_type: 'standard'
      });

      const response = await request(app)
        .get('/api/registry/vaults/by-creator/GD1234567890abcdef')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.vaults).toHaveLength(1);
      expect(response.body.data.vaults[0].project_name).toBe('Test Project');
      expect(response.body.data.pagination.total).toBe(1);
    });

    it('should handle invalid creator address', async () => {
      const response = await request(app)
        .get('/api/registry/vaults/by-creator/invalid')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid creator address format');
    });

    it('should respect pagination parameters', async () => {
      // Create multiple test vaults
      for (let i = 0; i < 5; i++) {
        await VaultRegistry.create({
          contract_id: `CA${i.toString().padStart(3, '0')}`,
          project_name: `Project ${i}`,
          creator_address: 'GD1234567890abcdef',
          deployment_ledger: 12345 + i,
          vault_type: 'standard'
        });
      }

      const response = await request(app)
        .get('/api/registry/vaults/by-creator/GD1234567890abcdef?limit=2&offset=1')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.vaults).toHaveLength(2);
      expect(response.body.data.pagination.total).toBe(5);
      expect(response.body.data.pagination.offset).toBe(1);
      expect(response.body.data.pagination.limit).toBe(2);
    });
  });

  describe('GET /api/registry/vaults/search', () => {
    it('should search vaults by project name', async () => {
      await VaultRegistry.create({
        contract_id: 'CA1234567890abcdef',
        project_name: 'Amazing DeFi Project',
        creator_address: 'GD1234567890abcdef',
        deployment_ledger: 12345,
        vault_type: 'standard'
      });

      const response = await request(app)
        .get('/api/registry/vaults/search?projectName=DeFi')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.vaults).toHaveLength(1);
      expect(response.body.data.vaults[0].project_name).toBe('Amazing DeFi Project');
    });

    it('should handle missing project name parameter', async () => {
      const response = await request(app)
        .get('/api/registry/vaults/search')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Project name must be at least 2 characters long');
    });

    it('should handle short project name', async () => {
      const response = await request(app)
        .get('/api/registry/vaults/search?projectName=a')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Project name must be at least 2 characters long');
    });
  });

  describe('GET /api/registry/vaults', () => {
    it('should return all vaults', async () => {
      await VaultRegistry.create({
        contract_id: 'CA1234567890abcdef',
        project_name: 'Test Project 1',
        creator_address: 'GD1234567890abcdef',
        deployment_ledger: 12345,
        vault_type: 'standard'
      });

      await VaultRegistry.create({
        contract_id: 'CA0987654321fedcba',
        project_name: 'Test Project 2',
        creator_address: 'GD0987654321fedcba',
        deployment_ledger: 12346,
        vault_type: 'cliff'
      });

      const response = await request(app)
        .get('/api/registry/vaults')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.vaults).toHaveLength(2);
      expect(response.body.data.pagination.total).toBe(2);
    });

    it('should filter by vault type', async () => {
      await VaultRegistry.create({
        contract_id: 'CA1234567890abcdef',
        project_name: 'Standard Vault',
        creator_address: 'GD1234567890abcdef',
        deployment_ledger: 12345,
        vault_type: 'standard'
      });

      await VaultRegistry.create({
        contract_id: 'CA0987654321fedcba',
        project_name: 'Cliff Vault',
        creator_address: 'GD0987654321fedcba',
        deployment_ledger: 12346,
        vault_type: 'cliff'
      });

      const response = await request(app)
        .get('/api/registry/vaults?vaultType=standard')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.vaults).toHaveLength(1);
      expect(response.body.data.vaults[0].vault_type).toBe('standard');
    });
  });

  describe('GET /api/registry/vaults/:contractId', () => {
    it('should return specific vault details', async () => {
      const vault = await VaultRegistry.create({
        contract_id: 'CA1234567890abcdef',
        project_name: 'Test Project',
        creator_address: 'GD1234567890abcdef',
        deployment_ledger: 12345,
        vault_type: 'standard'
      });

      const response = await request(app)
        .get(`/api/registry/vaults/${vault.contract_id}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.contract_id).toBe('CA1234567890abcdef');
      expect(response.body.data.project_name).toBe('Test Project');
    });

    it('should return 404 for non-existent vault', async () => {
      const response = await request(app)
        .get('/api/registry/vaults/CA000000000000000')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Vault not found in registry');
    });
  });

  describe('GET /api/registry/stats', () => {
    it('should return registry statistics', async () => {
      await VaultRegistry.create({
        contract_id: 'CA1234567890abcdef',
        project_name: 'Test Project 1',
        creator_address: 'GD1234567890abcdef',
        deployment_ledger: 12345,
        vault_type: 'standard'
      });

      await VaultRegistry.create({
        contract_id: 'CA0987654321fedcba',
        project_name: 'Test Project 2',
        creator_address: 'GD1234567890abcdef',
        deployment_ledger: 12346,
        vault_type: 'cliff'
      });

      const response = await request(app)
        .get('/api/registry/stats')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.total_vaults).toBe(2);
      expect(response.body.data.active_vaults).toBe(2);
      expect(response.body.data.unique_creators).toBe(1);
      expect(response.body.data.vaults_by_type.standard).toBe(1);
      expect(response.body.data.vaults_by_type.cliff).toBe(1);
    });

    it('should return zero statistics for empty registry', async () => {
      const response = await request(app)
        .get('/api/registry/stats')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.total_vaults).toBe(0);
      expect(response.body.data.active_vaults).toBe(0);
      expect(response.body.data.unique_creators).toBe(0);
      expect(response.body.data.vaults_by_type).toEqual({});
    });
  });
});
