const { VestingScheduleManager } = require('./src/services/vestingScheduleManager');
const { AssetDecimalNormalizer } = require('./src/services/assetDecimalNormalizer');

// Mock the Stellar SDK
jest.mock('@stellar/stellar-sdk', () => ({
  Address: {
    fromString: jest.fn(() => ({ toScVal: jest.fn() })),
  },
  BASE_FEE: '100',
  Contract: jest.fn().mockImplementation(() => ({
    call: jest.fn(() => ({ toXDR: jest.fn() })),
  })),
  Keypair: {
    fromSecret: jest.fn(() => ({
      publicKey: jest.fn(() => 'test-public-key'),
      sign: jest.fn(),
    })),
  },
  TransactionBuilder: {
    fee: jest.fn(),
    networkPassphrase: jest.fn(),
  },
  nativeToScVal: jest.fn(),
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getAccount: jest.fn().mockResolvedValue({
        sequenceNumber: '1',
      }),
      simulateTransaction: jest.fn().mockResolvedValue({
        result: {
          retval: {
            value: 'mock-result',
          },
        },
      }),
      sendTransaction: jest.fn().mockResolvedValue({
        hash: 'test-hash',
        status: 'PENDING',
      }),
      getTransaction: jest.fn().mockResolvedValue({
        status: 'SUCCESS',
      }),
    })),
    Api: {
      isSimulationError: jest.fn(() => false),
    },
  },
  scValToNative: jest.fn((val) => ({
    id: 'test-schedule',
    beneficiary: 'test-beneficiary',
    asset_code: 'USDC',
    unvested_balance: '1000000',
    total_amount: '5000000',
    vested_amount: '2000000',
    cliff_date: '2024-06-01T00:00:00Z',
    end_date: '2025-06-01T00:00:00Z',
    start_date: '2024-01-01T00:00:00Z',
    vesting_duration: 365,
  })),
}), { virtual: true });

describe('VestingScheduleManager with AssetDecimalNormalizer', () => {
  let manager;
  let mockConfig;

  beforeEach(() => {
    mockConfig = {
      soroban: {
        rpcUrl: 'https://test-rpc.stellar.org',
        contractId: 'test-contract-id',
        networkPassphrase: 'Test SDF Network ; September 2015',
        sourceSecret: 'test-source-secret',
      },
    };

    manager = new VestingScheduleManager(mockConfig);
  });

  describe('Cross-asset consolidation', () => {
    test('should consolidate schedules with different assets', async () => {
      const schedule1 = {
        id: 'schedule1',
        beneficiary: 'test-beneficiary',
        assetCode: 'XLM',
        unvestedBalance: '10000000', // 1 XLM
        cliff: '2024-06-01T00:00:00Z',
        end: '2025-06-01T00:00:00Z',
        startDate: '2024-01-01T00:00:00Z',
        vestingDuration: 365,
      };

      const schedule2 = {
        id: 'schedule2',
        beneficiary: 'test-beneficiary',
        assetCode: 'USDC',
        unvestedBalance: '2000000', // 2 USDC
        cliff: '2024-07-01T00:00:00Z',
        end: '2025-07-01T00:00:00Z',
        startDate: '2024-02-01T00:00:00Z',
        vestingDuration: 400,
      };

      // Mock getScheduleDetails to return our test schedules
      manager.getScheduleDetails = jest.fn()
        .mockResolvedValueOnce(schedule1)
        .mockResolvedValueOnce(schedule2);

      const result = await manager.consolidateSchedules(
        'test-beneficiary',
        'schedule1',
        'schedule2',
        'test-admin-pubkey',
        'test-admin-signature'
      );

      expect(result.success).toBe(true);
      expect(result.consolidatedSchedule.assetCode).toBe('XLM'); // Should prefer first schedule's asset
      expect(result.consolidatedSchedule.unvestedBalance).toBeDefined();
      expect(result.consolidatedSchedule.beneficiary).toBe('test-beneficiary');
    });

    test('should handle schedules with same asset', async () => {
      const schedule1 = {
        id: 'schedule1',
        beneficiary: 'test-beneficiary',
        assetCode: 'USDC',
        unvestedBalance: '1000000', // 1 USDC
        cliff: '2024-06-01T00:00:00Z',
        end: '2025-06-01T00:00:00Z',
        startDate: '2024-01-01T00:00:00Z',
        vestingDuration: 365,
      };

      const schedule2 = {
        id: 'schedule2',
        beneficiary: 'test-beneficiary',
        assetCode: 'USDC',
        unvestedBalance: '2000000', // 2 USDC
        cliff: '2024-07-01T00:00:00Z',
        end: '2025-07-01T00:00:00Z',
        startDate: '2024-02-01T00:00:00Z',
        vestingDuration: 400,
      };

      manager.getScheduleDetails = jest.fn()
        .mockResolvedValueOnce(schedule1)
        .mockResolvedValueOnce(schedule2);

      const result = await manager.consolidateSchedules(
        'test-beneficiary',
        'schedule1',
        'schedule2',
        'test-admin-pubkey',
        'test-admin-signature'
      );

      expect(result.success).toBe(true);
      expect(result.consolidatedSchedule.assetCode).toBe('USDC');
      expect(parseFloat(result.consolidatedSchedule.unvestedBalance)).toBeCloseTo(3000000, 0);
    });
  });

  describe('Decimal precision operations', () => {
    test('should sum unvested balances correctly across assets', () => {
      const schedule1 = {
        assetCode: 'XLM',
        unvestedBalance: '10000000', // 1 XLM (7 decimals)
      };

      const schedule2 = {
        assetCode: 'USDC',
        unvestedBalance: '2000000', // 2 USDC (6 decimals)
      };

      const sum = manager.sumUnvestedBalances(schedule1, schedule2, 'XLM');
      expect(sum).toBeDefined();
      expect(typeof sum).toBe('string');
    });

    test('should calculate weighted average dates with precision', () => {
      const schedule1 = {
        assetCode: 'XLM',
        unvestedBalance: '10000000', // 1 XLM
        cliff: '2024-01-01T00:00:00Z',
      };

      const schedule2 = {
        assetCode: 'USDC',
        unvestedBalance: '2000000', // 2 USDC
        cliff: '2024-02-01T00:00:00Z',
      };

      const weightedDate = manager.calculateWeightedAverageDate(schedule1, schedule2, 'cliff', 'XLM');
      expect(weightedDate).toBeDefined();
      expect(typeof weightedDate).toBe('string');
      expect(weightedDate).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/);
    });

    test('should calculate weighted average duration with precision', () => {
      const schedule1 = {
        assetCode: 'XLM',
        unvestedBalance: '10000000', // 1 XLM
        vestingDuration: 365,
      };

      const schedule2 = {
        assetCode: 'USDC',
        unvestedBalance: '2000000', // 2 USDC
        vestingDuration: 400,
      };

      const weightedDuration = manager.calculateWeightedAverageDuration(
        schedule1, 
        schedule2, 
        '3000000', // Total balance
        'XLM'
      );
      expect(weightedDuration).toBeDefined();
      expect(typeof weightedDuration).toBe('number');
      expect(weightedDuration).toBeGreaterThan(0);
    });
  });

  describe('Schedule normalization', () => {
    test('should normalize schedule with asset code', () => {
      const rawSchedule = {
        schedule_id: 'test-schedule',
        beneficiary_address: 'test-beneficiary',
        asset_code: 'USDC',
        unvested_balance: '1000000',
        total_amount: '5000000',
        vested_amount: '2000000',
        cliff_date: '2024-06-01T00:00:00Z',
        end_date: '2025-06-01T00:00:00Z',
        start_date: '2024-01-01T00:00:00Z',
        vesting_duration: 365,
      };

      const normalized = manager.normalizeSchedule(rawSchedule);

      expect(normalized.id).toBe('test-schedule');
      expect(normalized.beneficiary).toBe('test-beneficiary');
      expect(normalized.assetCode).toBe('USDC');
      expect(normalized.unvestedBalance).toBe(1000000);
      expect(normalized.totalAmount).toBe(5000000);
      expect(normalized.vestedAmount).toBe(2000000);
    });

    test('should handle empty or null schedule', () => {
      const normalized = manager.normalizeSchedule(null);
      expect(normalized.id).toBe('');
      expect(normalized.beneficiary).toBe('');
      expect(normalized.assetCode).toBe('XLM');
      expect(normalized.unvestedBalance).toBe(0);
    });

    test('should default to XLM when no asset code provided', () => {
      const rawSchedule = {
        id: 'test-schedule',
        beneficiary: 'test-beneficiary',
        unvested_balance: '1000000',
      };

      const normalized = manager.normalizeSchedule(rawSchedule);
      expect(normalized.assetCode).toBe('XLM');
    });
  });

  describe('Error handling', () => {
    test('should throw error for beneficiary mismatch', async () => {
      const schedule1 = {
        beneficiary: 'beneficiary1',
        assetCode: 'XLM',
        unvestedBalance: '10000000',
      };

      const schedule2 = {
        beneficiary: 'beneficiary2',
        assetCode: 'USDC',
        unvestedBalance: '2000000',
      };

      manager.getScheduleDetails = jest.fn()
        .mockResolvedValueOnce(schedule1)
        .mockResolvedValueOnce(schedule2);

      await expect(
        manager.consolidateSchedules(
          'different-beneficiary',
          'schedule1',
          'schedule2',
          'test-admin-pubkey',
          'test-admin-signature'
        )
      ).rejects.toThrow('Schedule beneficiary mismatch');
    });

    test('should handle zero balances gracefully', () => {
      const schedule1 = {
        assetCode: 'XLM',
        unvestedBalance: '0',
        cliff: '2024-01-01T00:00:00Z',
      };

      const schedule2 = {
        assetCode: 'USDC',
        unvestedBalance: '0',
        cliff: '2024-02-01T00:00:00Z',
      };

      const weightedDate = manager.calculateWeightedAverageDate(schedule1, schedule2, 'cliff', 'XLM');
      expect(weightedDate).toBe('2024-01-01T00:00:00Z');
    });
  });
});
