const cleanupService = require('../backend/src/services/cleanupService');
const { sequelize, Vault, SubSchedule, Beneficiary, CleanupTask, CleanupReward } = require('../backend/src/models');

describe('Gas Refund Incentive for Storage Cleanup', () => {
  beforeAll(async () => {
    await sequelize.sync({ force: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('should create a pending cleanup task and expose available reward', async () => {
    const vault = await Vault.create({
      address: 'VAULT-123',
      owner_address: 'OWNER-ABC',
      total_amount: '100.00',
      name: 'Test Vault',
      token_address: 'TOKEN-XYZ'
    });

    const fiveYearsAgo = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000);
    const fourYearsAgo = new Date(Date.now() - 4 * 365 * 24 * 60 * 60 * 1000);

    await SubSchedule.create({
      vault_id: vault.id,
      top_up_amount: '100.00',
      cliff_duration: 0,
      vesting_start_date: fiveYearsAgo,
      vesting_duration: 4 * 365 * 24 * 60 * 60,
      start_timestamp: fiveYearsAgo,
      end_timestamp: fourYearsAgo,
      transaction_hash: 'tx-1',
      amount_withdrawn: '100.00',
      cumulative_claimed_amount: '100.00',
      amount_released: '100.00',
      is_active: false
    });

    await Beneficiary.create({
      vault_id: vault.id,
      total_withdrawn: '100.00'
    });

    const eligibility = await cleanupService.isVaultEligibleForCleanup(vault.address);
    expect(eligibility.isEligible).toBe(true);

    const task = await cleanupService.createCleanupTask({
      vault_address: vault.address,
      platform_fee_paid: '50.00',
      bounty_percentage: 10,
      admin_address: 'admin-test'
    });

    expect(task.bounty_reward_amount).toBe('5');
    expect(task.status).toBe('pending');

    const rewards = await cleanupService.getAvailableRewards(vault.owner_address);
    expect(Array.isArray(rewards)).toBe(true);
    expect(rewards.length).toBe(1);
    expect(rewards[0].bounty_reward_amount).toBe('5');

    const claim = await cleanupService.claimReward({
      cleanup_task_id: task.id,
      claimer_address: 'claimer-1',
      transaction_hash: 'tx-claim-1',
      ledger_sequence: 123456
    });

    expect(claim.reward_amount).toBe('5');
    const updatedTask = await CleanupTask.findByPk(task.id);
    expect(updatedTask.status).toBe('claimed');
    expect(updatedTask.claimed_by_address).toBe('claimer-1');
  });

  it('should deny cleanup tasks before 4-year vesting period', async () => {
    const vault2 = await Vault.create({
      address: 'VAULT-456',
      owner_address: 'OWNER-ABC',
      total_amount: '50.00'
    });

    const oneYearAgo = new Date(Date.now() - 1 * 365 * 24 * 60 * 60 * 1000);
    const sixMonthsAgo = new Date(Date.now() - 0.5 * 365 * 24 * 60 * 60 * 1000);

    await SubSchedule.create({
      vault_id: vault2.id,
      top_up_amount: '50.00',
      cliff_duration: 0,
      vesting_start_date: oneYearAgo,
      vesting_duration: 365 * 24 * 60 * 60,
      start_timestamp: oneYearAgo,
      end_timestamp: sixMonthsAgo,
      transaction_hash: 'tx-2',
      amount_withdrawn: '50.00',
      cumulative_claimed_amount: '50.00',
      amount_released: '50.00',
      is_active: false
    });

    await Beneficiary.create({
      vault_id: vault2.id,
      total_withdrawn: '50.00'
    });

    const eligibility2 = await cleanupService.isVaultEligibleForCleanup(vault2.address);
    expect(eligibility2.isEligible).toBe(false);
    expect(eligibility2.reason).toMatch(/4 years/);
  });
});
