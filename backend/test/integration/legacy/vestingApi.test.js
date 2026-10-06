const request = require('supertest');

// Mock Redis client early to prevent connection attempts in tests
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(),
    isOpen: true,
  })),
}));

// Mock indexing service's initialization which might attempt connections
jest.mock('../src/services/indexingService', () => ({
  initialize: jest.fn().mockResolvedValue(),
  initContract: jest.fn(),
  indexHistoricalBlocks: jest.fn(),
  listenToEvents: jest.fn(),
}));
const { sequelize } = require('../src/database/connection');
const app = require('../src/index');

jest.setTimeout(60000);

describe('Vesting API Routes', () => {
  beforeAll(async () => {
    await sequelize.sync({ force: true });
  });



  beforeEach(async () => {
    await sequelize.models.Vault.destroy({ where: {}, force: true });
    await sequelize.models.SubSchedule.destroy({ where: {}, force: true });
    await sequelize.models.Beneficiary.destroy({ where: {}, force: true });
  });

  describe('POST /api/vaults', () => {
    test('should create a new vault', async () => {
      const vaultData = {
        address: '0x1234567890123456789012345678901234567890',
        name: 'Test Vault',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        owner_address: '0x1111111111111111111111111111111111111111',
        initial_amount: '1000',
        beneficiaries: [
          {
            address: '0x2222222222222222222222222222222222222222',
            allocation: '500'
          }
        ]
      };

      const response = await request(app)
        .post('/api/vaults')
        .send(vaultData)
        .expect(201);

      expect(response).toSatisfyApiSpec();
      expect(response.body.success).toBe(true);
      expect(response.body.data.address).toBe(vaultData.address);
      expect(response.body.data.name).toBe(vaultData.name);
    });

    test('should return error for invalid vault data', async () => {
      const invalidData = {
        // Missing required fields
        name: 'Test Vault'
      };

      const response = await request(app)
        .post('/api/vaults')
        .send(invalidData)
        .expect(500);

      expect(response).toSatisfyApiSpec();
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBeDefined();
    });
  });

  describe('POST /api/vaults/:vaultAddress/top-up', () => {
    let vault;

    beforeEach(async () => {
      // Create a vault first
      const vaultData = {
        address: '0x1234567890123456789012345678901234567890',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        owner_address: '0x1111111111111111111111111111111111111111'
      };

      const response = await request(app)
        .post('/api/vaults')
        .send(vaultData)
        .expect(201);

      vault = response.body.data;
    });

    test('should process a top-up with cliff', async () => {
      const topUpData = {
        amount: '500',
        cliff_duration_seconds: 86400,
        vesting_duration_seconds: 2592000,
        transaction_hash: '0xabcdef1234567890',
        block_number: 12345,
        timestamp: '2024-01-01T00:00:00Z'
      };

      const response = await request(app)
        .post(`/api/vaults/${vault.address}/top-up`)
        .send(topUpData)
        .expect(201);

      expect(response).toSatisfyApiSpec();
      expect(response.body.success).toBe(true);
      expect(response.body.data.top_up_amount).toBe('500');
      expect(response.body.data.cliff_duration).toBe(86400);
    });

    test('should return error for non-existent vault', async () => {
      const topUpData = {
        amount: '500',
        cliff_duration_seconds: 86400,
        vesting_duration_seconds: 2592000,
        transaction_hash: '0xabcdef1234567890',
        block_number: 12345
      };

      const response = await request(app)
        .post('/api/vaults/0xnonexistent/top-up')
        .send(topUpData)
        .expect(500);

      expect(response).toSatisfyApiSpec();
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('not found');
    });
  });

  describe('GET /api/vaults/:vaultAddress/schedule', () => {
    let vault;

    beforeEach(async () => {
      // Create and fund a vault
      const vaultData = {
        address: '0x1234567890123456789012345678901234567890',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        owner_address: '0x1111111111111111111111111111111111111111',
        beneficiaries: [
          {
            address: '0x2222222222222222222222222222222222222222',
            allocation: '500'
          }
        ]
      };

      const vaultResponse = await request(app)
        .post('/api/vaults')
        .send(vaultData)
        .expect(201);

      vault = vaultResponse.body.data;

      // Add a top-up
      await request(app)
        .post(`/api/vaults/${vault.address}/top-up`)
        .send({
          amount: '1000',
          cliff_duration_seconds: 86400,
          vesting_duration_seconds: 2592000,
          transaction_hash: '0xabcdef1234567890',
          block_number: 12345
        });
    });

    test('should get vesting schedule', async () => {
      const response = await request(app)
        .get(`/api/vaults/${vault.address}/schedule`)
        .expect(200);

      expect(response).toSatisfyApiSpec();
      expect(response.body.success).toBe(true);
      expect(response.body.data.address).toBe(vault.address);
      expect(response.body.data.subSchedules).toHaveLength(1);
      expect(response.body.data.beneficiaries).toHaveLength(1);
    });

    test('should get vesting schedule for specific beneficiary', async () => {
      const response = await request(app)
        .get(`/api/vaults/${vault.address}/schedule?beneficiaryAddress=0x2222222222222222222222222222222222222222`)
        .expect(200);

      expect(response).toSatisfyApiSpec();
      expect(response.body.success).toBe(true);
      expect(response.body.data.beneficiaries).toHaveLength(1);
      expect(response.body.data.beneficiaries[0].address).toBe('0x2222222222222222222222222222222222222222');
    });
  });

  describe('GET /api/vaults/:vaultAddress/:beneficiaryAddress/withdrawable', () => {
    let vault, beneficiaryAddress;

    beforeEach(async () => {
      beneficiaryAddress = '0x2222222222222222222222222222222222222222';

      // Create and fund a vault
      const vaultData = {
        address: '0x1234567890123456789012345678901234567890',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        owner_address: '0x1111111111111111111111111111111111111111',
        beneficiaries: [
          {
            address: beneficiaryAddress,
            allocation: '1000'
          }
        ]
      };

      const vaultResponse = await request(app)
        .post('/api/vaults')
        .send(vaultData)
        .expect(201);

      vault = vaultResponse.body.data;

      // Add a top-up with no cliff for easier testing
      await request(app)
        .post(`/api/vaults/${vault.address}/top-up`)
        .send({
          amount: '1000',
          cliff_duration_seconds: 0,
          vesting_duration_seconds: 2592000,
          transaction_hash: '0xabcdef1234567890',
          block_number: 12345,
          timestamp: '2024-01-01T00:00:00Z'
        });
    });

    test('should calculate withdrawable amount', async () => {
      const response = await request(app)
        .get(`/api/vaults/${vault.address}/${beneficiaryAddress}/withdrawable`)
        .query({ timestamp: '2024-01-16T00:00:00Z' }) // Half way through vesting
        .expect(200);

      expect(response).toSatisfyApiSpec();
      expect(response.body.success).toBe(true);
      expect(response.body.data.withdrawable).toBeCloseTo(500, 2);
      expect(response.body.data.total_vested).toBeCloseTo(500, 2);
    });
  });

  describe('POST /api/vaults/:vaultAddress/:beneficiaryAddress/withdraw', () => {
    let vault, beneficiaryAddress;

    beforeEach(async () => {
      beneficiaryAddress = '0x2222222222222222222222222222222222222222';

      // Create and fund a vault
      const vaultData = {
        address: '0x1234567890123456789012345678901234567890',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        owner_address: '0x1111111111111111111111111111111111111111',
        beneficiaries: [
          {
            address: beneficiaryAddress,
            allocation: '1000'
          }
        ]
      };

      const vaultResponse = await request(app)
        .post('/api/vaults')
        .send(vaultData)
        .expect(201);

      vault = vaultResponse.body.data;

      // Add a top-up with no cliff
      await request(app)
        .post(`/api/vaults/${vault.address}/top-up`)
        .send({
          amount: '1000',
          cliff_duration_seconds: 0,
          vesting_duration_seconds: 2592000,
          transaction_hash: '0xabcdef1234567890',
          block_number: 12345,
          timestamp: '2024-01-01T00:00:00Z'
        });
    });

    test('should process withdrawal', async () => {
      const withdrawalData = {
        amount: '200',
        transaction_hash: '0xwithdraw123456',
        block_number: 12346,
        timestamp: '2024-01-16T00:00:00Z' // Half vested
      };

      const response = await request(app)
        .post(`/api/vaults/${vault.address}/${beneficiaryAddress}/withdraw`)
        .send(withdrawalData)
        .expect(200);

      expect(response).toSatisfyApiSpec();
      expect(response.body.success).toBe(true);
      expect(response.body.data.amount_withdrawn).toBe(200);
      expect(response.body.data.distribution).toHaveLength(1);
    });

    test('should reject excessive withdrawal', async () => {
      const withdrawalData = {
        amount: '600', // More than vested
        transaction_hash: '0xwithdraw123456',
        block_number: 12346,
        timestamp: '2024-01-16T00:00:00Z' // Half vested (500)
      };

      const response = await request(app)
        .post(`/api/vaults/${vault.address}/${beneficiaryAddress}/withdraw`)
        .send(withdrawalData)
        .expect(500);

      expect(response).toSatisfyApiSpec();
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Insufficient vested amount');
    });
  });

  describe('GET /api/vaults/:vaultAddress/summary', () => {
    let vault;

    beforeEach(async () => {
      // Create a vault
      const vaultData = {
        address: '0x1234567890123456789012345678901234567890',
        name: 'Test Vault',
        token_address: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
        owner_address: '0x1111111111111111111111111111111111111111',
        beneficiaries: [
          {
            address: '0x2222222222222222222222222222222222222222',
            allocation: '500'
          }
        ]
      };

      const vaultResponse = await request(app)
        .post('/api/vaults')
        .send(vaultData)
        .expect(201);

      vault = vaultResponse.body.data;

      // Add a top-up
      await request(app)
        .post(`/api/vaults/${vault.address}/top-up`)
        .send({
          amount: '1000',
          cliff_duration_seconds: 86400,
          vesting_duration_seconds: 2592000,
          transaction_hash: '0xabcdef1234567890',
          block_number: 12345
        });
    });

    test('should return vault summary', async () => {
      const response = await request(app)
        .get(`/api/vaults/${vault.address}/summary`)
        .expect(200);


      expect(response.body.success).toBe(true);
      expect(response.body.data.vault_address).toBe(vault.address);
      expect(response.body.data.total_amount).toBe(1000);
      expect(response.body.data.total_top_ups).toBe(1);
      expect(response.body.data.total_beneficiaries).toBe(1);
      expect(response.body.data.sub_schedules).toHaveLength(1);
      expect(response.body.data.beneficiaries).toHaveLength(1);
    });
  });
});
