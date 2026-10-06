jest.mock('../models', () => ({
  Vault: {
    findAll: jest.fn(),
  },
  SubSchedule: {},
  VaultBalanceMonitorState: {
    findOrCreate: jest.fn(),
  },
}));

const { Vault, VaultBalanceMonitorState } = require('../models');
const VaultBalanceMonitorService = require('./vaultBalanceMonitorService');

describe('VaultBalanceMonitorService', () => {
  let balanceTracker;
  let alertService;
  let state;
  let service;

  beforeEach(() => {
    jest.clearAllMocks();

    delete process.env.VAULT_BALANCE_MONITOR_VAULT_ADDRESS;
    delete process.env.VAULT_BALANCE_MONITOR_TOKEN_ADDRESS;
    delete process.env.VAULT_BALANCE_MONITOR_TOLERANCE;
    delete process.env.VAULT_BALANCE_MONITOR_ENABLED;

    balanceTracker = {
      getActualBalance: jest.fn(),
    };

    alertService = {
      sendVaultBalanceDiscrepancyAlert: jest.fn().mockResolvedValue({ sent: true }),
    };

    state = {
      status: 'healthy',
      last_discrepancy_signature: null,
      last_alerted_at: null,
      update: jest.fn().mockImplementation(async (attrs) => {
        Object.assign(state, attrs);
        return state;
      }),
    };

    VaultBalanceMonitorState.findOrCreate.mockResolvedValue([state]);

    service = new VaultBalanceMonitorService({
      balanceTracker,
      alertService,
      now: () => new Date('2026-04-22T00:00:00.000Z'),
    });
  });

  it('sends a critical alert when on-chain balance differs from expected unvested balance', async () => {
    Vault.findAll.mockResolvedValue([
      {
        id: 'vault-1',
        address: 'VAULT-1',
        token_address: 'TOKEN-1',
        subSchedules: [
          {
            id: 'schedule-1',
            top_up_amount: '100',
            cumulative_claimed_amount: '0',
            amount_withdrawn: '0',
            cliff_date: null,
            vesting_start_date: new Date('2026-05-01T00:00:00.000Z'),
            vesting_duration: 3600,
            end_timestamp: new Date('2026-05-01T01:00:00.000Z'),
          },
        ],
      },
    ]);
    balanceTracker.getActualBalance.mockResolvedValue('90');

    const result = await service.runCheck();

    expect(result).toMatchObject({
      checked: 1,
      discrepancies: 1,
      alertsSent: 1,
      duplicateAlertsSuppressed: 0,
      errors: 0,
    });
    expect(alertService.sendVaultBalanceDiscrepancyAlert).toHaveBeenCalledTimes(1);
    expect(alertService.sendVaultBalanceDiscrepancyAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultAddress: 'VAULT-1',
        tokenAddress: 'TOKEN-1',
        onChainBalance: '90',
        expectedUnvestedBalance: '100',
        expectedUnclaimedBalance: '100',
        absoluteDifference: '10',
        differenceDirection: 'shortfall',
      })
    );
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'discrepancy',
        last_expected_unvested_balance: '100',
        last_difference: '10',
      })
    );
  });

  it('suppresses duplicate alerts for the same unresolved discrepancy', async () => {
    const vault = {
      id: 'vault-1',
      address: 'VAULT-1',
      token_address: 'TOKEN-1',
      subSchedules: [
        {
          id: 'schedule-1',
          top_up_amount: '100',
          cumulative_claimed_amount: '0',
          amount_withdrawn: '0',
          cliff_date: null,
          vesting_start_date: new Date('2026-05-01T00:00:00.000Z'),
          vesting_duration: 3600,
          end_timestamp: new Date('2026-05-01T01:00:00.000Z'),
        },
      ],
    };

    balanceTracker.getActualBalance.mockResolvedValue('90');

    const firstCheck = await service.checkVaultBalance(
      vault,
      new Date('2026-04-22T00:00:00.000Z')
    );
    const secondCheck = await service.checkVaultBalance(
      vault,
      new Date('2026-04-22T00:05:00.000Z')
    );

    expect(firstCheck.isDiscrepancy).toBe(true);
    expect(firstCheck.alertSent).toBe(true);
    expect(secondCheck.isDiscrepancy).toBe(true);
    expect(secondCheck.alertSent).toBe(false);
    expect(secondCheck.alertSuppressed).toBe(true);
    expect(alertService.sendVaultBalanceDiscrepancyAlert).toHaveBeenCalledTimes(1);
  });

  it('records an error state when the RPC balance lookup fails', async () => {
    Vault.findAll.mockResolvedValue([
      {
        id: 'vault-1',
        address: 'VAULT-1',
        token_address: 'TOKEN-1',
        subSchedules: [],
      },
    ]);
    balanceTracker.getActualBalance.mockRejectedValue(new Error('RPC timeout'));

    const result = await service.runCheck();

    expect(result).toMatchObject({
      checked: 1,
      discrepancies: 0,
      alertsSent: 0,
      errors: 1,
    });
    expect(state.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        last_error_message: 'RPC timeout',
      })
    );
  });
});
