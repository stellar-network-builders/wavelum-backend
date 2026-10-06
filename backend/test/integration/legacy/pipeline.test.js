'use strict';

/**
 * pipeline.test.js
 *
 * CI-friendly pipeline tests that cover the full vesting lifecycle.
 * Uses SQLite in-memory (NODE_ENV=test) so no external database is needed.
 *
 * Run with: NODE_ENV=test jest test/pipeline.test.js
 */

process.env.NODE_ENV = 'test';

const request = require('supertest');
const { sequelize } = require('../src/database/connection');
const app = require('../src/index');

// ─── helpers ────────────────────────────────────────────────────────────────

const VAULT_ADDRESS      = '0xa1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const TOKEN_ADDRESS      = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const OWNER_ADDRESS      = '0x1111111111111111111111111111111111111111';
const BENEFICIARY_ADDR   = '0x2222222222222222222222222222222222222222';
const TX_HASH            = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';

// ─── test setup / teardown ──────────────────────────────────────────────────

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

afterAll(async () => {
  await sequelize.close();
});

beforeEach(async () => {
  // Wipe relevant tables between tests to keep tests independent
  await sequelize.models.SubSchedule.destroy({ where: {}, truncate: true, cascade: true });
  await sequelize.models.Beneficiary.destroy({ where: {}, truncate: true, cascade: true });
  await sequelize.models.Vault.destroy({ where: {}, truncate: true, cascade: true });
});

// ─── 1. Health Checks ───────────────────────────────────────────────────────

describe('Health Checks', () => {
  test('GET / returns running message', async () => {
    const res = await request(app).get('/').expect(200);
    expect(res.body.message).toMatch(/Vesting Vault API is running/i);
  });

  test('GET /health returns OK status', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.timestamp).toBeDefined();
  });
});

// ─── 2. Vault Creation ──────────────────────────────────────────────────────

describe('POST /api/vaults', () => {
  test('creates a vault with beneficiaries and returns 201', async () => {
    const payload = {
      address: VAULT_ADDRESS,
      name: 'Pipeline Vault',
      token_address: TOKEN_ADDRESS,
      owner_address: OWNER_ADDRESS,
      beneficiaries: [{ address: BENEFICIARY_ADDR, allocation: '1000' }],
    };

    const res = await request(app).post('/api/vaults').send(payload).expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.address).toBe(VAULT_ADDRESS);
  });

  test('returns 500 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/vaults')
      .send({ name: 'No Address Vault' })
      .expect(500);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
  });
});

// ─── 3. Top-up ──────────────────────────────────────────────────────────────

describe('POST /api/vaults/:vaultAddress/top-up', () => {
  beforeEach(async () => {
    await request(app)
      .post('/api/vaults')
      .send({
        address: VAULT_ADDRESS,
        token_address: TOKEN_ADDRESS,
        owner_address: OWNER_ADDRESS,
        beneficiaries: [{ address: BENEFICIARY_ADDR, allocation: '1000' }],
      })
      .expect(201);
  });

  test('creates a sub-schedule with cliff and returns 201', async () => {
    const res = await request(app)
      .post(`/api/vaults/${VAULT_ADDRESS}/top-up`)
      .send({
        amount: '500',
        cliff_duration_seconds: 86400,      // 1 day
        vesting_duration_seconds: 2592000,  // 30 days
        transaction_hash: TX_HASH,
        block_number: 12345,
        timestamp: '2024-01-01T00:00:00Z',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(data.top_up_amount).toBe('500');
    expect(data.cliff_duration).toBe(86400);
    expect(data.vesting_duration).toBe(2592000);
  });

  test('returns 500 for non-existent vault', async () => {
    const res = await request(app)
      .post('/api/vaults/0xnonexistent/top-up')
      .send({
        amount: '100',
        cliff_duration_seconds: 0,
        vesting_duration_seconds: 86400,
        transaction_hash: TX_HASH,
      })
      .expect(500);
    expect(res.body.success).toBe(false);
  });
});

// ─── 4. Vesting Schedule ────────────────────────────────────────────────────

describe('GET /api/vaults/:vaultAddress/schedule', () => {
  beforeEach(async () => {
    await request(app).post('/api/vaults').send({
      address: VAULT_ADDRESS,
      token_address: TOKEN_ADDRESS,
      owner_address: OWNER_ADDRESS,
      beneficiaries: [{ address: BENEFICIARY_ADDR, allocation: '1000' }],
    });
    await request(app).post(`/api/vaults/${VAULT_ADDRESS}/top-up`).send({
      amount: '1000',
      cliff_duration_seconds: 86400,
      vesting_duration_seconds: 2592000,
      transaction_hash: TX_HASH,
      block_number: 1,
      timestamp: '2024-01-01T00:00:00Z',
    });
  });

  test('returns schedule with sub-schedules and beneficiaries', async () => {
    const res = await request(app)
      .get(`/api/vaults/${VAULT_ADDRESS}/schedule`)
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.address).toBe(VAULT_ADDRESS);
    expect(res.body.data.subSchedules).toHaveLength(1);
    expect(res.body.data.beneficiaries).toHaveLength(1);
  });

  test('filters by beneficiaryAddress query param', async () => {
    const res = await request(app)
      .get(`/api/vaults/${VAULT_ADDRESS}/schedule?beneficiaryAddress=${BENEFICIARY_ADDR}`)
      .expect(200);

    expect(res.body.data.beneficiaries).toHaveLength(1);
    expect(res.body.data.beneficiaries[0].address).toBe(BENEFICIARY_ADDR);
  });
});

// ─── 5. Withdrawable Amount ─────────────────────────────────────────────────

describe('GET /api/vaults/:vaultAddress/:beneficiaryAddress/withdrawable', () => {
  beforeEach(async () => {
    await request(app).post('/api/vaults').send({
      address: VAULT_ADDRESS,
      token_address: TOKEN_ADDRESS,
      owner_address: OWNER_ADDRESS,
      beneficiaries: [{ address: BENEFICIARY_ADDR, allocation: '1000' }],
    });
    // No cliff so vesting starts immediately from 2024-01-01
    await request(app).post(`/api/vaults/${VAULT_ADDRESS}/top-up`).send({
      amount: '1000',
      cliff_duration_seconds: 0,
      vesting_duration_seconds: 2592000, // 30 days
      transaction_hash: TX_HASH,
      block_number: 1,
      timestamp: '2024-01-01T00:00:00Z',
    });
  });

  test('returns ~half vested at mid-point', async () => {
    const res = await request(app)
      .get(`/api/vaults/${VAULT_ADDRESS}/${BENEFICIARY_ADDR}/withdrawable`)
      .query({ timestamp: '2024-01-16T00:00:00Z' }) // 15 days in ≈ 50%
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.withdrawable).toBeGreaterThan(400);
    expect(res.body.data.withdrawable).toBeLessThan(600);
  });

  test('returns 0 before vesting starts (cliff not yet passed)', async () => {
    // Add a second vault with cliff only for this test
    const V2 = '0xv2v2v2v2v2v2v2v2v2v2v2v2v2v2v2v2v2v2v2v2';
    await request(app).post('/api/vaults').send({
      address: V2,
      token_address: TOKEN_ADDRESS,
      owner_address: OWNER_ADDRESS,
      beneficiaries: [{ address: BENEFICIARY_ADDR, allocation: '1000' }],
    });
    await request(app).post(`/api/vaults/${V2}/top-up`).send({
      amount: '1000',
      cliff_duration_seconds: 86400, // 1 day cliff
      vesting_duration_seconds: 2592000,
      transaction_hash: TX_HASH + 'aa',
      block_number: 2,
      timestamp: '2024-01-01T00:00:00Z',
    });

    // Query at a time before cliff ends (30 min into the 1-day cliff)
    const res = await request(app)
      .get(`/api/vaults/${V2}/${BENEFICIARY_ADDR}/withdrawable`)
      .query({ timestamp: '2024-01-01T00:30:00Z' })
      .expect(200);

    expect(res.body.data.withdrawable).toBe(0);
    expect(res.body.data.total_vested).toBe(0);
  });
});

// ─── 6. Withdrawal ──────────────────────────────────────────────────────────

describe('POST /api/vaults/:vaultAddress/:beneficiaryAddress/withdraw', () => {
  beforeEach(async () => {
    await request(app).post('/api/vaults').send({
      address: VAULT_ADDRESS,
      token_address: TOKEN_ADDRESS,
      owner_address: OWNER_ADDRESS,
      beneficiaries: [{ address: BENEFICIARY_ADDR, allocation: '1000' }],
    });
    await request(app).post(`/api/vaults/${VAULT_ADDRESS}/top-up`).send({
      amount: '1000',
      cliff_duration_seconds: 0,
      vesting_duration_seconds: 2592000,
      transaction_hash: TX_HASH,
      block_number: 1,
      timestamp: '2024-01-01T00:00:00Z',
    });
  });

  test('processes a valid withdrawal successfully', async () => {
    const res = await request(app)
      .post(`/api/vaults/${VAULT_ADDRESS}/${BENEFICIARY_ADDR}/withdraw`)
      .send({
        amount: '200',
        transaction_hash: TX_HASH + 'b',
        block_number: 2,
        timestamp: '2024-01-16T00:00:00Z', // half vested → ~500 available
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.amount_withdrawn).toBe(200);
  });

  test('rejects withdrawal exceeding vested amount', async () => {
    const res = await request(app)
      .post(`/api/vaults/${VAULT_ADDRESS}/${BENEFICIARY_ADDR}/withdraw`)
      .send({
        amount: '800', // only ~500 vested at mid-point
        transaction_hash: TX_HASH + 'c',
        block_number: 3,
        timestamp: '2024-01-16T00:00:00Z',
      })
      .expect(500);

    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/insufficient vested amount/i);
  });
});

// ─── 7. Vault Summary ───────────────────────────────────────────────────────

describe('GET /api/vaults/:vaultAddress/summary', () => {
  beforeEach(async () => {
    await request(app).post('/api/vaults').send({
      address: VAULT_ADDRESS,
      name: 'Summary Vault',
      token_address: TOKEN_ADDRESS,
      owner_address: OWNER_ADDRESS,
      beneficiaries: [{ address: BENEFICIARY_ADDR, allocation: '500' }],
    });
    await request(app).post(`/api/vaults/${VAULT_ADDRESS}/top-up`).send({
      amount: '1000',
      cliff_duration_seconds: 86400,
      vesting_duration_seconds: 2592000,
      transaction_hash: TX_HASH,
      block_number: 1,
      timestamp: '2024-01-01T00:00:00Z',
    });
  });

  test('returns a complete vault summary', async () => {
    const res = await request(app)
      .get(`/api/vaults/${VAULT_ADDRESS}/summary`)
      .expect(200);

    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.vault_address).toBe(VAULT_ADDRESS);
    expect(d.total_amount).toBe(1000);
    expect(d.total_top_ups).toBe(1);
    expect(d.total_beneficiaries).toBe(1);
    expect(d.sub_schedules).toHaveLength(1);
    expect(d.beneficiaries).toHaveLength(1);
  });

  test('returns 500 for unknown vault address', async () => {
    const res = await request(app)
      .get('/api/vaults/0xunknown/summary')
      .expect(500);
    expect(res.body.success).toBe(false);
  });
});
