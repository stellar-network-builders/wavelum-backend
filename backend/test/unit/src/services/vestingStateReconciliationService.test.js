'use strict';

const VestingStateReconciliationService = require('../services/vestingStateReconciliationService');

// ── Mocks ──────────────────────────────────────────────────────────────────────

const mockSubSchedules = [];
const mockBeneficiaries = [];
const mockClaimsHistory = [];
const mockSorobanEvents = [];
const mockReconRecords = [];

let mockVaults = [];

function resetMocks() {
  mockSubSchedules.length = 0;
  mockBeneficiaries.length = 0;
  mockClaimsHistory.length = 0;
  mockSorobanEvents.length = 0;
  mockReconRecords.length = 0;
  mockVaults = [
    {
      id: 'vault-1',
      address: 'VAULT_ADDR_1',
      token_address: 'TOKEN_ADDR_1',
      token_type: 'static',
      total_amount: '1000',
      is_active: true,
      is_blacklisted: false,
    },
  ];
}

// Seed a healthy vault
function seedHealthyVault() {
  resetMocks();
  mockSubSchedules.push({
    id: 'ss-1',
    vault_id: 'vault-1',
    top_up_amount: '1000',
    cliff_duration: 0,
    cliff_date: null,
    vesting_start_date: new Date('2024-01-01'),
    vesting_duration: 31536000, // 1 year
    end_timestamp: new Date('2025-01-01'),
    transaction_hash: 'tx-1',
    block_number: 100,
    amount_withdrawn: '100',
    cumulative_claimed_amount: '100',
    is_active: true,
  });
  mockBeneficiaries.push({
    id: 'b-1',
    vault_id: 'vault-1',
    address: 'BEN_ADDR_1',
    total_allocated: '1000',
    total_withdrawn: '100',
  });
  mockClaimsHistory.push({
    id: 'ch-1',
    user_address: 'BEN_ADDR_1',
    token_address: 'TOKEN_ADDR_1',
    amount_claimed: '100',
    claim_timestamp: new Date(),
    transaction_hash: 'tx-claim-1',
    block_number: 200,
  });
}

// Seed a vault with precision drift
function seedDriftVault() {
  resetMocks();
  mockSubSchedules.push({
    id: 'ss-drift',
    vault_id: 'vault-1',
    top_up_amount: '1000',
    cliff_duration: 0,
    cliff_date: null,
    vesting_start_date: new Date('2024-01-01'),
    vesting_duration: 31536000,
    end_timestamp: new Date('2025-01-01'),
    transaction_hash: 'tx-drift',
    block_number: 100,
    amount_withdrawn: '99.999999999',
    cumulative_claimed_amount: '100',
    is_active: true,
  });
  mockBeneficiaries.push({
    id: 'b-1',
    vault_id: 'vault-1',
    address: 'BEN_ADDR_1',
    total_allocated: '1000',
    total_withdrawn: '99.999999999',
  });
  mockClaimsHistory.push({
    id: 'ch-1',
    user_address: 'BEN_ADDR_1',
    token_address: 'TOKEN_ADDR_1',
    amount_claimed: '100',
    claim_timestamp: new Date(),
    transaction_hash: 'tx-claim-1',
    block_number: 200,
  });
}

// Seed a vault with unprocessed events
function seedUnprocessedEventsVault() {
  seedHealthyVault();
  mockSorobanEvents.push(
    { id: 'evt-1', processed: false, contract_address: 'VAULT_ADDR_1' },
    { id: 'evt-2', processed: false, contract_address: 'TOKEN_ADDR_1' }
  );
}

// ── Mock module overrides ──────────────────────────────────────────────────────

jest.mock('../models', () => ({
  Vault: {
    findAll: jest.fn(() => Promise.resolve(mockVaults)),
    findOne: jest.fn(({ where }) => {
      const v = mockVaults.find(v => v.address === where?.address);
      return Promise.resolve(v || null);
    }),
    findByPk: jest.fn((id) => {
      const v = mockVaults.find(v => v.id === id);
      return Promise.resolve(v || null);
    }),
  },
  Beneficiary: {
    findAll: jest.fn(() => Promise.resolve(mockBeneficiaries)),
    findOne: jest.fn(() => Promise.resolve(mockBeneficiaries[0] || null)),
  },
  SubSchedule: {
    findAll: jest.fn(() => Promise.resolve(mockSubSchedules)),
    findOne: jest.fn(() => Promise.resolve(mockSubSchedules[0] || null)),
    findByPk: jest.fn((id) => {
      const ss = mockSubSchedules.find(s => s.id === id);
      return Promise.resolve(ss || null);
    }),
    count: jest.fn(() => Promise.resolve(mockSubSchedules.length)),
  },
  ClaimsHistory: {
    findAll: jest.fn(() => Promise.resolve(mockClaimsHistory)),
    count: jest.fn(() => Promise.resolve(mockClaimsHistory.length)),
  },
  SorobanEvent: {
    count: jest.fn(({ where }) => {
      const filtered = mockSorobanEvents.filter(e => {
        if (where.processed !== undefined && e.processed !== where.processed) return false;
        if (where.contract_address && e.contract_address !== where.contract_address) return false;
        return true;
      });
      return Promise.resolve(filtered.length);
    }),
  },
  IndexerState: {},
  sequelize: {
    transaction: jest.fn(() => Promise.resolve({
      commit: jest.fn(),
      rollback: jest.fn(),
    })),
  },
  Op: { gt: Symbol('gt'), between: Symbol('between'), ne: Symbol('ne') },
}));

jest.mock('../models/vestingStateReconciliation', () => {
  const mockRecord = {
    id: 'recon-1',
    update: jest.fn(() => Promise.resolve()),
  };
  return {
    create: jest.fn(() => {
      mockReconRecords.push(mockRecord);
      return Promise.resolve(mockRecord);
    }),
    findOne: jest.fn(() => Promise.resolve(null)),
    findAll: jest.fn(() => Promise.resolve(mockReconRecords)),
  };
});

jest.mock('../services/claimCalculator', () => {
  return class ClaimCalculator {
    _calculateVestedAmount(subSchedule, currentTime) {
      const topUp = parseFloat(subSchedule.top_up_amount) || 0;
      const duration = subSchedule.vesting_duration || 1;
      if (!subSchedule.vesting_start_date) return 0;
      const start = new Date(subSchedule.vesting_start_date).getTime();
      const now = currentTime instanceof Date ? currentTime.getTime() : Date.now();
      const elapsed = Math.max(0, now - start) / 1000;
      if (elapsed >= duration) return topUp;
      return (elapsed * topUp) / duration;
    }
  };
});

jest.mock('../services/balanceTracker', () => {
  return class BalanceTracker {
    constructor() {}
    async getActualBalance() { return '900'; }
  };
});

jest.mock('../services/sorobanRpcClient', () => {
  return class SorobanRpcClient {
    constructor() {}
    async getLatestLedger() { return { sequence: 5000 }; }
  };
});

jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
}));

jest.mock('../services/auditLogger', () => ({
  logAction: jest.fn(),
}));

jest.mock('../services/slackWebhookService', () => ({
  sendAlert: jest.fn(() => Promise.resolve({ sent: true })),
}));

jest.mock('../database/connection', () => ({
  sequelize: {
    transaction: jest.fn(() => Promise.resolve({
      commit: jest.fn(),
      rollback: jest.fn(),
    })),
  },
}));

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('VestingStateReconciliationService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    resetMocks();
    service = new VestingStateReconciliationService({
      autoReconcile: false,
      rpcTimeout: 5000,
      maxRetries: 1,
    });
  });

  describe('constructor', () => {
    test('should initialize with default config', () => {
      const svc = new VestingStateReconciliationService();
      expect(svc.serviceName).toBe('vesting-state-reconciliation');
      expect(svc.isRunning).toBe(false);
      expect(svc.autoReconcile).toBe(false);
      expect(svc.precisionTolerance).toBe(1e-18);
    });

    test('should accept custom config', () => {
      const svc = new VestingStateReconciliationService({
        precisionTolerance: 0.01,
        autoReconcile: true,
        batchSize: 10,
      });
      expect(svc.precisionTolerance).toBe(0.01);
      expect(svc.autoReconcile).toBe(true);
      expect(svc.batchSize).toBe(10);
    });
  });

  describe('reconcileVault', () => {
    test('should return in_sync for a healthy vault', async () => {
      seedHealthyVault();
      const result = await service.reconcileVault('VAULT_ADDR_1', 'manual');
      expect(result.status).toBe('in_sync');
      expect(result.vault_address).toBe('VAULT_ADDR_1');
      expect(result.auto_reconciled).toBe(false);
    });

    test('should detect precision drift when amount_withdrawn diverges from cumulative_claimed', async () => {
      seedDriftVault();
      const result = await service.reconcileVault('VAULT_ADDR_1', 'manual');
      expect(result.status).toBe('desync_detected');
      expect(result.desync_details).toBeDefined();
      const driftCheck = result.desync_details.find(d => d.check === 'precision_drift');
      expect(driftCheck).toBeDefined();
      expect(driftCheck.passed).toBe(false);
    });

    test('should detect unprocessed events', async () => {
      seedUnprocessedEventsVault();
      const result = await service.reconcileVault('VAULT_ADDR_1', 'manual');
      expect(result.status).toBe('desync_detected');
      const evtCheck = result.desync_details.find(d => d.check === 'unprocessed_events');
      expect(evtCheck).toBeDefined();
      expect(evtCheck.passed).toBe(false);
      expect(evtCheck.total).toBe(2);
    });

    test('should reject blacklisted vaults', async () => {
      resetMocks();
      mockVaults = [{
        id: 'vault-bl',
        address: 'BL_ADDR',
        token_address: 'TOK',
        token_type: 'static',
        total_amount: '0',
        is_active: true,
        is_blacklisted: true,
      }];
      const result = await service.reconcileVault('BL_ADDR', 'manual');
      expect(result.status).toBe('error');
      expect(result.error).toContain('blacklisted');
    });
  });

  describe('reconcileAllVaults', () => {
    test('should process all active non-blacklisted vaults', async () => {
      seedHealthyVault();
      mockVaults.push({
        id: 'vault-2',
        address: 'VAULT_ADDR_2',
        token_address: 'TOKEN_ADDR_2',
        token_type: 'static',
        total_amount: '500',
        is_active: true,
        is_blacklisted: false,
      });

      const summary = await service.reconcileAllVaults('scheduled');
      expect(summary.checked).toBe(2);
      expect(summary.inSync).toBeGreaterThanOrEqual(1);
      expect(summary.errors).toBe(0);
    });

    test('should prevent concurrent runs', async () => {
      service.isRunning = true;
      await expect(service.reconcileAllVaults()).rejects.toThrow('already in progress');
      service.isRunning = false;
    });
  });

  describe('_checkSubScheduleCount', () => {
    test('should pass when on-chain count is unavailable', () => {
      const result = service._checkSubScheduleCount(
        { subScheduleCount: 3 },
        { onChainSubScheduleCount: null }
      );
      expect(result.passed).toBe(true);
    });

    test('should pass when counts match', () => {
      const result = service._checkSubScheduleCount(
        { subScheduleCount: 3 },
        { onChainSubScheduleCount: 3 }
      );
      expect(result.passed).toBe(true);
    });

    test('should fail when counts differ', () => {
      const result = service._checkSubScheduleCount(
        { subScheduleCount: 3 },
        { onChainSubScheduleCount: 5 }
      );
      expect(result.passed).toBe(false);
      expect(result.difference).toBe(2);
    });
  });

  describe('_checkPrecisionDrift', () => {
    test('should pass when no drift', () => {
      const result = service._checkPrecisionDrift({
        precisionDriftAccum: 0,
        subScheduleCount: 1,
        subScheduleDetails: [{ id: 'ss-1', drift: 0 }],
      });
      expect(result.passed).toBe(true);
    });

    test('should fail when drift exceeds tolerance', () => {
      const result = service._checkPrecisionDrift({
        precisionDriftAccum: 0.001,
        subScheduleCount: 1,
        subScheduleDetails: [{ id: 'ss-1', drift: 0.001 }],
      });
      expect(result.passed).toBe(false);
      expect(result.driftTotal).toBe(0.001);
    });
  });

  describe('_checkBeneficiaryWithdrawals', () => {
    test('should pass when totals are consistent', () => {
      const result = service._checkBeneficiaryWithdrawals({
        beneficiaryTotalWithdrawn: 100,
        offChainCumulativeClaimed: 100,
      });
      expect(result.passed).toBe(true);
    });

    test('should fail when totals diverge significantly', () => {
      const result = service._checkBeneficiaryWithdrawals({
        beneficiaryTotalWithdrawn: 50,
        offChainCumulativeClaimed: 100,
      });
      expect(result.passed).toBe(false);
    });
  });

  describe('_checkUnprocessedEvents', () => {
    test('should pass when no unprocessed events', async () => {
      const result = await service._checkUnprocessedEvents({
        address: 'VAULT_1',
        token_address: 'TOKEN_1',
      });
      expect(result.passed).toBe(true);
    });
  });

  describe('getStatus', () => {
    test('should return current service status', () => {
      const status = service.getStatus();
      expect(status.serviceName).toBe('vesting-state-reconciliation');
      expect(status.isRunning).toBe(false);
      expect(status.config).toBeDefined();
      expect(status.config.precisionTolerance).toBe(1e-18);
    });
  });

  describe('updateConfig', () => {
    test('should update service configuration', () => {
      service.updateConfig({ precisionTolerance: 0.01, autoReconcile: true });
      expect(service.precisionTolerance).toBe(0.01);
      expect(service.autoReconcile).toBe(true);
    });
  });
});

describe('VestingStateReconciliationJob', () => {
  const VestingStateReconciliationJob = require('../jobs/vestingStateReconciliationJob');

  beforeEach(() => {
    jest.clearAllMocks();
    resetMocks();
  });

  test('should instantiate with default schedule', () => {
    const job = new VestingStateReconciliationJob();
    expect(job.isRunning).toBe(false);
    expect(job.cronSchedule).toBeDefined();
  });

  test('should expose getStatus', () => {
    const job = new VestingStateReconciliationJob();
    const status = job.getStatus();
    expect(status.isRunning).toBe(false);
    expect(status.service).toBeDefined();
  });

  test('should update config via updateConfig', () => {
    const job = new VestingStateReconciliationJob();
    job.updateConfig({ precisionTolerance: 0.5 });
    expect(job.service.precisionTolerance).toBe(0.5);
  });
});
