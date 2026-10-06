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

const app = require('../src/index');
const { sequelize } = require('../src/database/connection');
const { Vault, SubSchedule } = require('../src/models');

describe('Delegate Functionality Tests', () => {
  let testVault;
  let testSubSchedule;
  
  const ownerAddress = '0x1234567890123456789012345678901234567890';
  const delegateAddress = '0x9876543210987654321098765432109876543210';
  const vaultAddress = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
  const tokenAddress = '0x1111111111111111111111111111111111111111';
  const totalAmount = '1000.0';
  
  beforeAll(async () => {
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  beforeEach(async () => {
    // Create a test vault
    testVault = await Vault.create({
      address: vaultAddress,
      owner_address: ownerAddress,
      token_address: tokenAddress,
      total_amount: totalAmount,
      start_date: new Date('2023-01-01'),
      end_date: new Date('2023-12-31'),
      cliff_date: new Date('2023-06-01'),
    });

    // Create a test sub schedule
    testSubSchedule = await SubSchedule.create({
      vault_id: testVault.id,
      top_up_amount: '1000.0',
      top_up_transaction_hash: '0x1234567890abcdef',
      top_up_timestamp: new Date('2023-01-01'),
      start_timestamp: new Date('2023-01-01'),
      end_timestamp: new Date('2023-12-31'),
      transaction_hash: '0x1234567890abcdef',
      cliff_duration: 86400 * 30, // 30 days
      cliff_date: new Date('2023-02-01'),
      vesting_start_date: new Date('2023-02-01'),
      vesting_duration: 86400 * 365, // 1 year
      amount_released: '0.0',
    });
  });

  afterEach(async () => {
    await SubSchedule.destroy({ where: {} });
    await Vault.destroy({ where: {} });
  });

  describe('POST /api/delegate/set', () => {
    it('should set a delegate for a vault successfully', async () => {
      const response = await request(app)
        .post('/api/delegate/set')
        .send({
          vaultId: testVault.id,
          ownerAddress: ownerAddress,
          delegateAddress: delegateAddress,
        });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBe('Delegate set successfully');
      expect(response.body.data.vault.delegate_address).toBe(delegateAddress);
    });

    it('should reject setting delegate for non-owner', async () => {
      const wrongOwner = '0x1111111111111111111111111111111111111111';
      
      const response = await request(app)
        .post('/api/delegate/set')
        .send({
          vaultId: testVault.id,
          ownerAddress: wrongOwner,
          delegateAddress: delegateAddress,
        });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Vault not found or access denied');
    });

    it('should reject invalid delegate address', async () => {
      const invalidDelegate = 'invalid_address';
      
      const response = await request(app)
        .post('/api/delegate/set')
        .send({
          vaultId: testVault.id,
          ownerAddress: ownerAddress,
          delegateAddress: invalidDelegate,
        });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Invalid delegate address');
    });
  });

  describe('POST /api/delegate/claim', () => {
    beforeEach(async () => {
      // Set delegate for the vault
      await testVault.update({ delegate_address: delegateAddress });
      
      // Set sub schedule to be fully vested
      await testSubSchedule.update({
        vesting_start_date: new Date('2022-01-01'),
        vesting_duration: 86400 * 365, // 1 year
      });
    });

    it('should allow delegate to claim tokens successfully', async () => {
      const response = await request(app)
        .post('/api/delegate/claim')
        .send({
          delegateAddress: delegateAddress,
          vaultAddress: vaultAddress,
          releaseAmount: '100.0',
        });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBe('Tokens claimed successfully by delegate');
      expect(response.body.data.releaseAmount).toBe('100.0');
      expect(response.body.data.ownerAddress).toBe(ownerAddress);
      expect(response.body.data.delegateAddress).toBe(delegateAddress);
    });

    it('should reject claim from unauthorized address', async () => {
      const unauthorizedAddress = '0x1111111111111111111111111111111111111111';
      
      const response = await request(app)
        .post('/api/delegate/claim')
        .send({
          delegateAddress: unauthorizedAddress,
          vaultAddress: vaultAddress,
          releaseAmount: '100.0',
        });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Vault not found or delegate not authorized');
    });

    it('should reject claim with insufficient releasable amount', async () => {
      // Set sub schedule to not be vested yet
      await testSubSchedule.update({
        vesting_start_date: new Date('2030-01-01'),
        vesting_duration: 86400 * 365,
      });

      const response = await request(app)
        .post('/api/delegate/claim')
        .send({
          delegateAddress: delegateAddress,
          vaultAddress: vaultAddress,
          releaseAmount: '100.0',
        });

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Insufficient releasable amount');
    });
  });

  describe('GET /api/delegate/:vaultAddress/info', () => {
    it('should return vault information including delegate', async () => {
      // Set delegate for the vault
      await testVault.update({ delegate_address: delegateAddress });

      const response = await request(app)
        .get(`/api/delegate/${vaultAddress}/info`);

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.vault.address).toBe(vaultAddress);
      expect(response.body.data.vault.owner_address).toBe(ownerAddress);
      expect(response.body.data.vault.delegate_address).toBe(delegateAddress);
      expect(response.body.data.vault.subSchedules).toBeDefined();
    });

    it('should return 404 for non-existent vault', async () => {
      const nonExistentVault = '0x9999999999999999999999999999999999999999';
      
      const response = await request(app)
        .get(`/api/delegate/${nonExistentVault}/info`);

      expect(response).toSatisfyApiSpec();
      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Vault not found or inactive');
    });
  });

  describe('Integration Tests', () => {
    it('should complete full delegate workflow', async () => {
      // 1. Set delegate
      const setDelegateResponse = await request(app)
        .post('/api/delegate/set')
        .send({
          vaultId: testVault.id,
          ownerAddress: ownerAddress,
          delegateAddress: delegateAddress,
        });

      expect(setDelegateResponse).toSatisfyApiSpec();
      expect(setDelegateResponse.status).toBe(200);
      expect(setDelegateResponse.body.success).toBe(true);

      // 2. Verify delegate is set
      const infoResponse = await request(app)
        .get(`/api/delegate/${vaultAddress}/info`);

      expect(infoResponse).toSatisfyApiSpec();
      expect(infoResponse.status).toBe(200);
      expect(infoResponse.body.data.vault.delegate_address).toBe(delegateAddress);

      // 3. Make sub schedule fully vested
      await testSubSchedule.update({
        vesting_start_date: new Date('2022-01-01'),
        vesting_duration: 86400 * 365,
      });

      // 4. Delegate claims tokens
      const claimResponse = await request(app)
        .post('/api/delegate/claim')
        .send({
          delegateAddress: delegateAddress,
          vaultAddress: vaultAddress,
          releaseAmount: '50.0',
        });

      expect(claimResponse).toSatisfyApiSpec();
      expect(claimResponse.status).toBe(200);
      expect(claimResponse.body.success).toBe(true);

      // 5. Verify updated sub schedule
      const updatedInfoResponse = await request(app)
        .get(`/api/delegate/${vaultAddress}/info`);

      expect(updatedInfoResponse).toSatisfyApiSpec();
      const updatedSubSchedule = updatedInfoResponse.body.data.vault.subSchedules[0];
      expect(parseFloat(updatedSubSchedule.amount_released)).toBe(50.0);
    });
  });
});
