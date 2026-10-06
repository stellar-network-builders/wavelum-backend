'use strict';

const vestingUnlockSyncService = require('../src/services/vestingUnlockSyncService');
const { SubSchedule, Vault, Beneficiary, VestingMilestone } = require('../src/models');

// Mock dependencies
jest.mock('../src/utils/eventPriorityQueue', () => {
  return class MockQueue {
    constructor() {
      this.events = [];
    }
    enqueue(data, priority) {
      this.events.push({ data, priority: new Date(priority).getTime() });
      this.events.sort((a, b) => a.priority - b.priority);
    }
    getDueEvents(now) {
      const currentTime = new Date(now).getTime();
      const due = this.events.filter(e => e.priority <= currentTime);
      this.events = this.events.filter(e => e.priority > currentTime);
      return due.map(e => e.data);
    }
    size() { return this.events.length; }
    isEmpty() { return this.events.length === 0; }
  };
});

jest.mock('../src/models', () => ({
  SubSchedule: {
    findAll: jest.fn(),
    findByPk: jest.fn()
  },
  Vault: {
    findByPk: jest.fn()
  },
  Beneficiary: {
    findAll: jest.fn()
  },
  VestingMilestone: {
    create: jest.fn()
  },
  Op: {
    gt: Symbol('gt'),
    or: Symbol('or')
  }
}));

describe('VestingUnlockSyncService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    vestingUnlockSyncService.stop();
    vestingUnlockSyncService.queue.events = [];
  });

  test('should load future milestones into queue', async () => {
    const futureDate = new Date(Date.now() + 100000);
    SubSchedule.findAll.mockResolvedValue([
      {
        id: 'sub1',
        vault_id: 'vault1',
        cliff_date: futureDate,
        end_timestamp: new Date(futureDate.getTime() + 100000),
        is_active: true,
        vault: { token_address: 'token1' }
      }
    ]);

    await vestingUnlockSyncService.loadFutureMilestones();

    expect(vestingUnlockSyncService.queue.size()).toBe(2); // One for cliff, one for end
  });

  test('should process due events and create milestones', async () => {
    const pastDate = new Date(Date.now() - 1000);
    const event = { type: 'CLIFF_REACHED', subScheduleId: 'sub1', vaultId: 'vault1' };
    
    vestingUnlockSyncService.queue.enqueue(event, pastDate);

    SubSchedule.findByPk.mockResolvedValue({
      id: 'sub1',
      vault_id: 'vault1',
      top_up_amount: '1000',
      vesting_start_date: new Date(Date.now() - 5000),
      end_timestamp: new Date(Date.now() + 5000),
      vault: { token_address: 'token1' }
    });

    Beneficiary.findAll.mockResolvedValue([
      { id: 'ben1', address: 'addr1' }
    ]);

    await vestingUnlockSyncService.processDueEvents();

    expect(VestingMilestone.create).toHaveBeenCalledWith(expect.objectContaining({
      sub_schedule_id: 'sub1',
      beneficiary_id: 'ben1',
      milestone_type: 'cliff_end'
    }));
  });

  test('should calculate vested amount correctly', () => {
    const start = new Date('2026-01-01');
    const end = new Date('2026-01-03'); // 2 days
    const sub = {
      top_up_amount: '100',
      vesting_start_date: start,
      end_timestamp: end,
      cliff_date: null
    };

    // Halfway through
    const now = new Date('2026-01-02');
    const amount = vestingUnlockSyncService._calculateVestedAmount(sub, now);
    expect(amount).toBe(50);
  });
});
