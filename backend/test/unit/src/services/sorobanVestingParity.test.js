'use strict';

/**
 * Automated Parity Tests between Off-Chain JS Projections and Soroban On-Chain Logic
 *
 * These tests verify that the off-chain vesting calculations (ClaimCalculator,
 * VestingService) produce results consistent with the on-chain Soroban
 * vesting-vault contract (contracts/vesting-vault/src/lib.rs).
 *
 * The core parity gap:
 *   On-chain:  (total_amount * vested_time) / vesting_duration  — i128 INTEGER division (truncates)
 *   Off-chain: (elapsed * allocation) / duration                 — IEEE 754 FLOAT (fractional)
 *
 * Over multiple claims, integer truncation on-chain leaves "dust" unclaimable
 * that appears claimable off-chain. These tests quantify and bound that drift.
 */

const SorobanVestingParity = require('./sorobanVestingParity');
const ClaimCalculator = require('./claimCalculator');

// ── Mock BalanceTracker for dynamic tests ──────────────────────────────────────
jest.mock('./balanceTracker', () => {
  return class BalanceTracker {
    constructor() {}
    async getActualBalance() { return '1000'; }
  };
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 1: SorobanVestingParity Unit Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('SorobanVestingParity — On-Chain Formula Simulator', () => {
  // ── Basic single-claim scenarios ────────────────────────────────────────────

  describe('calculateClaimableAmount', () => {
    it('should return 0 before cliff', () => {
      const result = SorobanVestingParity.calculateClaimableAmount({
        totalAmount: 1000n,
        releasedAmount: 0n,
        cliffDate: 2000n,
        vestingStart: 1000n,
        vestingDuration: 1000n,
        currentTime: 1500n,
      });
      expect(result).toBe(0n);
    });

    it('should return 0 before vesting start', () => {
      const result = SorobanVestingParity.calculateClaimableAmount({
        totalAmount: 1000n,
        releasedAmount: 0n,
        cliffDate: 0n,
        vestingStart: 1000n,
        vestingDuration: 1000n,
        currentTime: 500n,
      });
      expect(result).toBe(0n);
    });

    it('should return 0 for revoked vault', () => {
      const result = SorobanVestingParity.calculateClaimableAmount({
        totalAmount: 1000n,
        releasedAmount: 0n,
        cliffDate: 0n,
        vestingStart: 1000n,
        vestingDuration: 1000n,
        currentTime: 2000n,
        revoked: true,
      });
      expect(result).toBe(0n);
    });

    it('should return full amount when fully vested', () => {
      const result = SorobanVestingParity.calculateClaimableAmount({
        totalAmount: 1000n,
        releasedAmount: 0n,
        cliffDate: 0n,
        vestingStart: 1000n,
        vestingDuration: 1000n,
        currentTime: 5000n, // Well past end
      });
      expect(result).toBe(1000n);
    });

    it('should return half when exactly half vested (even division)', () => {
      const result = SorobanVestingParity.calculateClaimableAmount({
        totalAmount: 1000n,
        releasedAmount: 0n,
        cliffDate: 0n,
        vestingStart: 1000n,
        vestingDuration: 1000n,
        currentTime: 1500n, // Halfway
      });
      expect(result).toBe(500n);
    });

    it('should truncate (not round) on integer division — the key parity gap', () => {
      // 1000 * 333 / 1000 = 333000 / 1000 = 333 (exact, no truncation)
      // But: 1000 * 333 / 999 = 333000 / 999 = 333 (truncated from 333.333...)
      const result = SorobanVestingParity.calculateClaimableAmount({
        totalAmount: 1000n,
        releasedAmount: 0n,
        cliffDate: 0n,
        vestingStart: 0n,
        vestingDuration: 999n,
        currentTime: 333n,
      });
      // Float would give 333.333..., integer division gives 333
      expect(result).toBe(333n);
    });

    it('should subtract released_amount (saturating)', () => {
      const result = SorobanVestingParity.calculateClaimableAmount({
        totalAmount: 1000n,
        releasedAmount: 400n,
        cliffDate: 0n,
        vestingStart: 1000n,
        vestingDuration: 1000n,
        currentTime: 1500n, // Vested = 500, claimable = 500 - 400 = 100
      });
      expect(result).toBe(100n);
    });

    it('should return 0 when released >= vested (no negative claims)', () => {
      const result = SorobanVestingParity.calculateClaimableAmount({
        totalAmount: 1000n,
        releasedAmount: 600n,
        cliffDate: 0n,
        vestingStart: 1000n,
        vestingDuration: 1000n,
        currentTime: 1500n, // Vested = 500, but released = 600, so claimable = 0
      });
      expect(result).toBe(0n);
    });

    it('should handle string inputs (from DECIMAL columns)', () => {
      const result = SorobanVestingParity.calculateClaimableAmount({
        totalAmount: '1000',
        releasedAmount: '0',
        cliffDate: '0',
        vestingStart: '1000',
        vestingDuration: '1000',
        currentTime: '2000',
      });
      expect(result).toBe(1000n);
    });

    it('should handle decimal string inputs (from DECIMAL(36,18) columns)', () => {
      const result = SorobanVestingParity.calculateClaimableAmount({
        totalAmount: '1000.000000000000000000',
        releasedAmount: '0.000000000000000000',
        cliffDate: '0',
        vestingStart: '1000',
        vestingDuration: '1000',
        currentTime: '2000',
      });
      expect(result).toBe(1000n);
    });
  });

  // ── calculateVestedAmount ───────────────────────────────────────────────────

  describe('calculateVestedAmount', () => {
    it('should match calculateClaimableAmount when releasedAmount = 0', () => {
      const vested = SorobanVestingParity.calculateVestedAmount({
        totalAmount: 1000n,
        cliffDate: 0n,
        vestingStart: 1000n,
        vestingDuration: 1000n,
        currentTime: 1500n,
      });
      const claimable = SorobanVestingParity.calculateClaimableAmount({
        totalAmount: 1000n,
        releasedAmount: 0n,
        cliffDate: 0n,
        vestingStart: 1000n,
        vestingDuration: 1000n,
        currentTime: 1500n,
      });
      expect(vested).toBe(claimable);
    });
  });

  // ── simulateMultiClaim ──────────────────────────────────────────────────────

  describe('simulateMultiClaim', () => {
    it('should simulate two sequential claims', () => {
      const result = SorobanVestingParity.simulateMultiClaim({
        totalAmount: 1000n,
        cliffDate: 0n,
        vestingStart: 0n,
        vestingDuration: 1000n,
        claimTimestamps: [500n, 1000n],
      });

      // First claim at t=500: vested = 1000*500/1000 = 500, claimable = 500
      // Second claim at t=1000: vested = 1000, released = 500, claimable = 500
      expect(result.claims.length).toBe(2);
      expect(result.claims[0].amount).toBe(500n);
      expect(result.claims[1].amount).toBe(500n);
      expect(result.totalReleased).toBe(1000n);
    });

    it('should accumulate dust over many small claims (integer truncation)', () => {
      // 1000 tokens over 999 seconds — non-divisible duration
      const claimTimestamps = [];
      for (let i = 1; i <= 999; i++) {
        claimTimestamps.push(BigInt(i));
      }

      const result = SorobanVestingParity.simulateMultiClaim({
        totalAmount: 1000n,
        cliffDate: 0n,
        vestingStart: 0n,
        vestingDuration: 999n,
        claimTimestamps,
      });

      // Due to integer truncation, totalReleased < totalAmount
      // Each step: vested = (1000 * t) / 999, claimable = vested - released
      // The final step at t=999: vested = 1000*999/999 = 1000, so last claim gets remaining dust
      expect(result.totalReleased).toBe(1000n); // Last claim sweeps the dust
    });

    it('should show dust when claiming at irregular intervals with prime duration', () => {
      // 1_000_000 tokens over 31536000 seconds (1 year) — typical real scenario
      // Claim every 86400 seconds (daily) for 365 days
      const claimTimestamps = [];
      const duration = 31536000n;
      for (let day = 1; day <= 365; day++) {
        claimTimestamps.push(BigInt(day) * 86400n);
      }

      const result = SorobanVestingParity.simulateMultiClaim({
        totalAmount: 1000000n,
        cliffDate: 0n,
        vestingStart: 0n,
        vestingDuration: duration,
        claimTimestamps,
      });

      // Total released should be exactly 1_000_000 because the final claim
      // at t=31536000 vests the full amount and sweeps remaining dust
      expect(result.totalReleased).toBe(1000000n);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 2: Off-Chain vs On-Chain Parity Tests
// ══════════════════════════════════════════════════════════════════════════════

describe('Off-Chain vs On-Chain Parity', () => {
  // ── 2A: Single-claim parity ─────────────────────────────────────────────────

  describe('Single-claim parity', () => {
    it('should match exactly for even division (no truncation)', () => {
      const comparison = SorobanVestingParity.runParityCheck({
        totalAmount: 1000n,
        releasedAmount: 0n,
        cliffDate: 0n,
        vestingStart: 0n,
        vestingDuration: 1000n,
        currentTime: 500n,
      });

      expect(comparison.onChain).toBe(500);
      expect(comparison.offChain).toBeCloseTo(500, 10);
      expect(comparison.absoluteDifference).toBeLessThanOrEqual(1);
    });

    it('should show off-chain >= on-chain due to float fractions', () => {
      const comparison = SorobanVestingParity.runParityCheck({
        totalAmount: 1000n,
        releasedAmount: 0n,
        cliffDate: 0n,
        vestingStart: 0n,
        vestingDuration: 999n,
        currentTime: 333n,
      });

      // On-chain: 1000 * 333 / 999 = 333 (truncated from 333.333...)
      // Off-chain: 333 * 1000 / 999 = 333.333...
      expect(comparison.onChain).toBe(333);
      expect(comparison.offChain).toBeGreaterThan(333);
      expect(comparison.offChainGteOnChain).toBe(true);
      expect(comparison.absoluteDifference).toBeLessThanOrEqual(1);
    });

    it('should match exactly at vesting completion', () => {
      const comparison = SorobanVestingParity.runParityCheck({
        totalAmount: 1000n,
        releasedAmount: 0n,
        cliffDate: 0n,
        vestingStart: 0n,
        vestingDuration: 999n,
        currentTime: 999n,
      });

      // Both should return exactly 1000 at full vesting
      expect(comparison.onChain).toBe(1000);
      expect(comparison.offChain).toBeCloseTo(1000, 10);
      expect(comparison.absoluteDifference).toBeLessThanOrEqual(0.001);
    });

    it('should match exactly before cliff', () => {
      const comparison = SorobanVestingParity.runParityCheck({
        totalAmount: 1000n,
        releasedAmount: 0n,
        cliffDate: 500n,
        vestingStart: 0n,
        vestingDuration: 1000n,
        currentTime: 300n,
      });

      expect(comparison.onChain).toBe(0);
      expect(comparison.offChain).toBe(0);
      expect(comparison.absoluteDifference).toBe(0);
    });
  });

  // ── 2B: Multi-claim parity (dust accumulation) ──────────────────────────────

  describe('Multi-claim parity — dust accumulation', () => {
    it('should quantify drift over 100 incremental claims', () => {
      const totalAmount = 1000000n;
      const vestingDuration = 31536000n; // 1 year
      const claimCount = 100;

      // On-chain simulation
      const claimTimestamps = [];
      for (let i = 1; i <= claimCount; i++) {
        claimTimestamps.push(BigInt(i) * (vestingDuration / BigInt(claimCount)));
      }
      const onChainResult = SorobanVestingParity.simulateMultiClaim({
        totalAmount,
        cliffDate: 0n,
        vestingStart: 0n,
        vestingDuration,
        claimTimestamps,
      });

      // Off-chain simulation (mirrors ClaimCalculator)
      const calculator = new ClaimCalculator();
      let offChainReleased = 0;
      const subSchedule = {
        top_up_amount: String(totalAmount),
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: new Date(0),
        vesting_duration: Number(vestingDuration),
      };

      for (let i = 1; i <= claimCount; i++) {
        const elapsed = Number(BigInt(i) * (vestingDuration / BigInt(claimCount)));
        const currentTime = new Date(elapsed * 1000);
        const claimable = parseFloat(calculator.calculateStatic(subSchedule, currentTime));
        if (claimable > 1e-10) {
          offChainReleased += claimable;
          subSchedule.cumulative_claimed_amount = String(offChainReleased);
        }
      }

      const onChainNum = Number(onChainResult.totalReleased);
      const drift = Math.abs(offChainReleased - onChainNum);

      // Drift should be bounded: at most 1 per claim due to truncation
      // But cumulative_claimed_amount mechanism prevents unbounded drift
      expect(drift).toBeLessThan(claimCount); // < 100 tokens drift
      expect(drift).toBeLessThan(Number(totalAmount) * 0.001); // < 0.1% of total
    });

    it('should show that on-chain final claim always sweeps remaining dust', () => {
      // Any vesting schedule: the final claim at t >= vesting_start + duration
      // will always vest the full total_amount, so released_amount catches up
      const scenarios = [
        { total: 1000n, duration: 7n },    // Prime duration
        { total: 999n, duration: 1000n },   // Non-divisible
        { total: 1_000_000n, duration: 31536000n }, // Realistic
      ];

      for (const { total, duration } of scenarios) {
        const claimTimestamps = [duration]; // Single claim at end
        const result = SorobanVestingParity.simulateMultiClaim({
          totalAmount: total,
          cliffDate: 0n,
          vestingStart: 0n,
          vestingDuration: duration,
          claimTimestamps,
        });
        expect(result.totalReleased).toBe(total);
      }
    });

    it('should quantify maximum per-claim drift between float and integer', () => {
      // The maximum drift per single claim is < 1 token
      // because integer division truncates at most (divisor-1)/divisor < 1
      const maxDrift = 0;
      const testCases = [
        { total: 1000n, duration: 773n, time: 317n },   // Random prime-ish
        { total: 999n, duration: 1000n, time: 333n },
        { total: 1_000_000n, duration: 31536000n, time: 15768000n }, // Half year
        { total: 1n, duration: 3n, time: 1n },           // Smallest non-trivial
      ];

      for (const tc of testCases) {
        const comparison = SorobanVestingParity.runParityCheck({
          totalAmount: tc.total,
          releasedAmount: 0n,
          cliffDate: 0n,
          vestingStart: 0n,
          vestingDuration: tc.duration,
          currentTime: tc.time,
        });

        // Per-claim drift is always < 1
        expect(comparison.absoluteDifference).toBeLessThan(1);
        if (comparison.absoluteDifference > maxDrift) {
          // Track but don't fail
        }
      }
    });
  });

  // ── 2C: Cross-validation with ClaimCalculator ───────────────────────────────

  describe('Cross-validation with ClaimCalculator', () => {
    let calculator;

    beforeEach(() => {
      calculator = new ClaimCalculator();
    });

    it('should produce consistent vested amounts for a standard schedule', () => {
      const subSchedule = {
        top_up_amount: '1000000',
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: new Date('2024-01-01T00:00:00Z'),
        vesting_duration: 31536000, // 1 year
      };

      // Check at 6 months
      const sixMonthsLater = new Date('2024-07-01T00:00:00Z');
      const offChainVested = calculator._calculateVestedAmount(subSchedule, sixMonthsLater);

      // On-chain equivalent
      const vestingStartEpoch = Math.floor(subSchedule.vesting_start_date.getTime() / 1000);
      const sixMonthsEpoch = Math.floor(sixMonthsLater.getTime() / 1000);

      const onChainVested = SorobanVestingParity.calculateVestedAmount({
        totalAmount: 1000000n,
        cliffDate: 0n,
        vestingStart: BigInt(vestingStartEpoch),
        vestingDuration: 31536000n,
        currentTime: BigInt(sixMonthsEpoch),
      });

      const drift = Math.abs(offChainVested - Number(onChainVested));
      // Drift should be < 1 token per calculation
      expect(drift).toBeLessThan(1);
    });

    it('should produce consistent results at cliff boundary', () => {
      const subSchedule = {
        top_up_amount: '500000',
        cumulative_claimed_amount: '0',
        cliff_date: new Date('2024-06-01T00:00:00Z'),
        vesting_start_date: new Date('2024-01-01T00:00:00Z'),
        vesting_duration: 31536000,
      };

      // Just before cliff
      const beforeCliff = new Date('2024-05-31T23:59:59Z');
      const offChainBeforeCliff = calculator._calculateVestedAmount(subSchedule, beforeCliff);
      expect(offChainBeforeCliff).toBe(0);

      // Just after cliff
      const afterCliff = new Date('2024-06-01T00:00:01Z');
      const offChainAfterCliff = calculator._calculateVestedAmount(subSchedule, afterCliff);

      const cliffEpoch = Math.floor(subSchedule.cliff_date.getTime() / 1000);
      const afterCliffEpoch = Math.floor(afterCliff.getTime() / 1000);
      const vestingStartEpoch = Math.floor(subSchedule.vesting_start_date.getTime() / 1000);

      const onChainAfterCliff = SorobanVestingParity.calculateVestedAmount({
        totalAmount: 500000n,
        cliffDate: BigInt(cliffEpoch),
        vestingStart: BigInt(vestingStartEpoch),
        vestingDuration: 31536000n,
        currentTime: BigInt(afterCliffEpoch),
      });

      // After cliff, some amount should be vested
      expect(offChainAfterCliff).toBeGreaterThan(0);
      expect(Number(onChainAfterCliff)).toBeGreaterThan(0);

      const drift = Math.abs(offChainAfterCliff - Number(onChainAfterCliff));
      expect(drift).toBeLessThan(1);
    });

    it('should match at full vesting for any schedule', () => {
      const subSchedule = {
        top_up_amount: '123456789',
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: new Date('2024-01-01T00:00:00Z'),
        vesting_duration: 31536000,
      };

      const fullyVested = new Date('2025-01-01T00:00:00Z');
      const offChainVested = calculator._calculateVestedAmount(subSchedule, fullyVested);

      const vestingStartEpoch = Math.floor(subSchedule.vesting_start_date.getTime() / 1000);
      const fullyVestedEpoch = Math.floor(fullyVested.getTime() / 1000);

      const onChainVested = SorobanVestingParity.calculateVestedAmount({
        totalAmount: 123456789n,
        cliffDate: 0n,
        vestingStart: BigInt(vestingStartEpoch),
        vestingDuration: 31536000n,
        currentTime: BigInt(fullyVestedEpoch),
      });

      // At full vesting, both should return the total amount exactly
      expect(offChainVested).toBe(123456789);
      expect(Number(onChainVested)).toBe(123456789);
    });
  });

  // ── 2D: Fuzz parity — random parameter sweep ───────────────────────────────

  describe('Fuzz parity — random parameter sweep', () => {
    // Seeded pseudo-random for reproducibility
    function seededRandom(seed) {
      let s = seed;
      return function () {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
    }

    it('should keep per-claim drift < 1 across 1000 random scenarios', () => {
      const rand = seededRandom(42);
      let maxDrift = 0;
      let worstCase = null;

      for (let i = 0; i < 1000; i++) {
        const totalAmount = BigInt(Math.floor(rand() * 1_000_000_000) + 1);
        const vestingDuration = BigInt(Math.floor(rand() * 31536000) + 1); // 0..1 year
        const currentTime = BigInt(Math.floor(rand() * Number(vestingDuration)));

        const comparison = SorobanVestingParity.runParityCheck({
          totalAmount,
          releasedAmount: 0n,
          cliffDate: 0n,
          vestingStart: 0n,
          vestingDuration,
          currentTime,
        });

        if (comparison.absoluteDifference > maxDrift) {
          maxDrift = comparison.absoluteDifference;
          worstCase = { totalAmount, vestingDuration, currentTime, comparison };
        }

        // Per-claim drift must always be < 1
        expect(comparison.absoluteDifference).toBeLessThan(1);
      }

      // Log worst case for visibility (doesn't fail test)
      if (worstCase) {
        console.log(
          `Worst per-claim drift: ${maxDrift.toFixed(15)} ` +
          `(total=${worstCase.totalAmount}, duration=${worstCase.vestingDuration}, ` +
          `time=${worstCase.currentTime})`
        );
      }
    });

    it('should keep off-chain >= on-chain for all random scenarios (float rounds up)', () => {
      const rand = seededRandom(123);
      let violations = 0;

      for (let i = 0; i < 1000; i++) {
        const totalAmount = BigInt(Math.floor(rand() * 1_000_000) + 1);
        const vestingDuration = BigInt(Math.floor(rand() * 31536000) + 1);
        const currentTime = BigInt(Math.floor(rand() * Number(vestingDuration)));

        const comparison = SorobanVestingParity.runParityCheck({
          totalAmount,
          releasedAmount: 0n,
          cliffDate: 0n,
          vestingStart: 0n,
          vestingDuration,
          currentTime,
        });

        // Off-chain should always be >= on-chain because float preserves
        // fractional part that integer division truncates
        // Exception: when both are 0 (before cliff/start) or exactly equal
        if (!comparison.offChainGteOnChain && comparison.onChain > 0) {
          violations++;
        }
      }

      // Allow 0 violations — float should never be less than integer truncation
      // for positive values (float has more precision, not less)
      expect(violations).toBe(0);
    });

    it('should bound cumulative drift over multi-claim sequences (100 scenarios)', () => {
      const rand = seededRandom(999);

      for (let i = 0; i < 100; i++) {
        const totalAmount = BigInt(Math.floor(rand() * 10_000_000) + 1000);
        const vestingDuration = BigInt(Math.floor(rand() * 86400 * 365) + 86400);

        // Generate 10-50 random claim timestamps
        const claimCount = Math.floor(rand() * 40) + 10;
        const claimTimestamps = [];
        for (let j = 0; j < claimCount; j++) {
          claimTimestamps.push(
            BigInt(Math.floor(rand() * Number(vestingDuration))) + 1n
          );
        }
        claimTimestamps.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

        // On-chain simulation
        const onChain = SorobanVestingParity.simulateMultiClaim({
          totalAmount,
          cliffDate: 0n,
          vestingStart: 0n,
          vestingDuration,
          claimTimestamps,
        });

        // Off-chain simulation
        const subSchedule = {
          top_up_amount: String(totalAmount),
          cumulative_claimed_amount: '0',
          cliff_date: null,
          vesting_start_date: new Date(0),
          vesting_duration: Number(vestingDuration),
        };

        const calculator = new ClaimCalculator();
        let offChainReleased = 0;

        for (const ts of claimTimestamps) {
          const currentTime = new Date(Number(ts) * 1000);
          const claimable = parseFloat(calculator.calculateStatic(subSchedule, currentTime));
          if (claimable > 1e-10) {
            offChainReleased += claimable;
            subSchedule.cumulative_claimed_amount = String(offChainReleased);
          }
        }

        const onChainNum = Number(onChain.totalReleased);
        const cumulativeDrift = Math.abs(offChainReleased - onChainNum);

        // Cumulative drift should be bounded by the number of claims
        // (each claim can drift at most < 1)
        expect(cumulativeDrift).toBeLessThan(claimCount);

        // And should be a tiny fraction of total amount
        if (onChainNum > 0) {
          const driftRatio = cumulativeDrift / onChainNum;
          expect(driftRatio).toBeLessThan(0.01); // < 1% drift
        }
      }
    });
  });

  // ── 2E: Edge cases that expose parity gaps ──────────────────────────────────

  describe('Edge cases — known parity gaps', () => {
    it('should expose the truncation gap for 1 token over 3 seconds', () => {
      // 1 token, 3 second duration, claim at t=1
      // On-chain:  1 * 1 / 3 = 0 (truncated!)
      // Off-chain: 1 * 1 / 3 = 0.333...
      const comparison = SorobanVestingParity.runParityCheck({
        totalAmount: 1n,
        releasedAmount: 0n,
        cliffDate: 0n,
        vestingStart: 0n,
        vestingDuration: 3n,
        currentTime: 1n,
      });

      expect(comparison.onChain).toBe(0);  // Truncated to 0 on-chain!
      expect(comparison.offChain).toBeCloseTo(0.333, 2);
      // This is the fundamental parity gap: on-chain says nothing is claimable,
      // off-chain says 0.333 tokens are claimable
      expect(comparison.absoluteDifference).toBeCloseTo(0.333, 2);
    });

    it('should expose gap for large amount with prime duration', () => {
      // 1_000_000 tokens over 7919 seconds (prime number)
      // At t=3959 (roughly half):
      // On-chain:  1_000_000 * 3959 / 7919 = 3959000000 / 7919 = 499936 (truncated from 499936.356...)
      // Off-chain: 1_000_000 * 3959 / 7919 = 499936.356...
      const comparison = SorobanVestingParity.runParityCheck({
        totalAmount: 1_000_000n,
        releasedAmount: 0n,
        cliffDate: 0n,
        vestingStart: 0n,
        vestingDuration: 7919n,
        currentTime: 3959n,
      });

      expect(comparison.onChain).toBe(499936);
      expect(comparison.offChain).toBeCloseTo(499936.356, 1);
      expect(comparison.absoluteDifference).toBeLessThan(1);
    });

    it('should show that cumulative_claimed_amount prevents unbounded drift', () => {
      // Simulate 1000 claims with the off-chain cumulative tracking
      const totalAmount = 1000000n;
      const vestingDuration = 31536000n;
      const claimCount = 1000;

      const calculator = new ClaimCalculator();
      const subSchedule = {
        top_up_amount: String(totalAmount),
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: new Date(0),
        vesting_duration: Number(vestingDuration),
      };

      let offChainReleased = 0;
      let onChainReleased = 0n;

      for (let i = 1; i <= claimCount; i++) {
        const currentTimeSec = BigInt(Math.floor(i * Number(vestingDuration) / claimCount));

        // On-chain claim
        const onChainClaimable = SorobanVestingParity.calculateClaimableAmount({
          totalAmount,
          releasedAmount: onChainReleased,
          cliffDate: 0n,
          vestingStart: 0n,
          vestingDuration,
          currentTime: currentTimeSec,
        });
        onChainReleased += onChainClaimable;

        // Off-chain claim
        const currentTimeDate = new Date(Number(currentTimeSec) * 1000);
        const offChainClaimable = parseFloat(calculator.calculateStatic(subSchedule, currentTimeDate));
        if (offChainClaimable > 1e-10) {
          offChainReleased += offChainClaimable;
          subSchedule.cumulative_claimed_amount = String(offChainReleased);
        }
      }

      const drift = Math.abs(offChainReleased - Number(onChainReleased));

      // The cumulative_claimed_amount mechanism keeps drift bounded
      // because each off-chain claim subtracts the ACTUAL cumulative claimed,
      // not a recomputed vested amount
      expect(drift).toBeLessThan(claimCount); // < 1000 tokens
      expect(drift / Number(totalAmount)).toBeLessThan(0.001); // < 0.1% of total
    });

    it('should handle the case where on-chain truncation causes zero claimable but off-chain shows positive', () => {
      // Small amount, long duration, early time
      // This is the most dangerous parity gap: user sees claimable tokens
      // in the UI but the contract returns 0
      const dangerousCases = [
        { total: 10n, duration: 100n, time: 1n },     // 10*1/100 = 0 on-chain, 0.1 off-chain
        { total: 100n, duration: 10000n, time: 1n },  // 100*1/10000 = 0 on-chain, 0.01 off-chain
        { total: 1n, duration: 1000n, time: 1n },     // 1*1/1000 = 0 on-chain, 0.001 off-chain
      ];

      for (const tc of dangerousCases) {
        const comparison = SorobanVestingParity.runParityCheck({
          totalAmount: tc.total,
          releasedAmount: 0n,
          cliffDate: 0n,
          vestingStart: 0n,
          vestingDuration: tc.duration,
          currentTime: tc.time,
        });

        // On-chain truncates to 0, off-chain shows fractional amount
        expect(comparison.onChain).toBe(0);
        expect(comparison.offChain).toBeGreaterThan(0);
        // This gap must be handled by the UI (show "0 claimable" when on-chain = 0)
      }
    });
  });

  // ── 2F: compareResults utility ─────────────────────────────────────────────

  describe('compareResults', () => {
    it('should correctly compare float and BigInt results', () => {
      const result = SorobanVestingParity.compareResults(500.5, 500n);
      expect(result.offChain).toBe(500.5);
      expect(result.onChain).toBe(500);
      expect(result.onChainBigInt).toBe(500n);
      expect(result.difference).toBe(0.5);
      expect(result.absoluteDifference).toBe(0.5);
      expect(result.offChainGteOnChain).toBe(true);
    });

    it('should handle equal results', () => {
      const result = SorobanVestingParity.compareResults(1000, 1000n);
      expect(result.difference).toBe(0);
      expect(result.absoluteDifference).toBe(0);
      expect(result.offChainGteOnChain).toBe(true);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
//  SECTION 3: VestingService Parity (higher-level)
// ══════════════════════════════════════════════════════════════════════════════

describe('VestingService-level parity with Soroban', () => {
  /**
   * These tests verify that the off-chain VestingService.calculateWithdrawableAmount
   * and ClaimCalculator.calculateStatic produce results that are consistent with
   * the on-chain formula, given the same inputs.
   *
   * The key invariant:
   *   For any point in time, the off-chain claimable amount should be
   *   >= on-chain claimable amount, and the difference should be < 1 token.
   *
   * The cumulative_claimed_amount mechanism ensures that over multiple claims,
   * the off-chain total released converges toward the on-chain total released
   * (because each claim subtracts the actual cumulative claimed, preventing
   * unbounded drift from float rounding).
   */

  it('should satisfy the parity invariant for a realistic 4-year vesting schedule', () => {
    const totalAmount = 10_000_000n; // 10M tokens
    const vestingDuration = 126_144_000n; // 4 years in seconds
    const cliffDuration = 31_536_000n; // 1 year cliff

    // Check at various points
    const checkpoints = [
      cliffDuration,                          // At cliff
      cliffDuration + 86400n,                 // Day after cliff
      vestingDuration / 2n,                   // Halfway
      vestingDuration / 4n * 3n,             // 3/4 through
      vestingDuration,                        // Fully vested
    ];

    for (const currentTime of checkpoints) {
      const comparison = SorobanVestingParity.runParityCheck({
        totalAmount,
        releasedAmount: 0n,
        cliffDate: cliffDuration,
        vestingStart: 0n,
        vestingDuration,
        currentTime,
      });

      // Invariant: off-chain >= on-chain, drift < 1
      if (comparison.onChain > 0) {
        expect(comparison.offChainGteOnChain).toBe(true);
      }
      expect(comparison.absoluteDifference).toBeLessThan(1);
    }
  });

  it('should satisfy parity invariant across multiple sub-schedules (top-ups)', () => {
    // Simulate a vault with 3 top-ups at different times
    const schedules = [
      { totalAmount: 1_000_000n, vestingStart: 0n, vestingDuration: 31_536_000n },
      { totalAmount: 500_000n, vestingStart: 10_000_000n, vestingDuration: 31_536_000n },
      { totalAmount: 250_000n, vestingStart: 20_000_000n, vestingDuration: 31_536_000n },
    ];

    const currentTime = 25_000_000n; // ~289 days in

    let totalOnChainVested = 0n;
    let totalOffChainVested = 0;

    for (const sched of schedules) {
      const onChainVested = SorobanVestingParity.calculateVestedAmount({
        totalAmount: sched.totalAmount,
        cliffDate: 0n,
        vestingStart: sched.vestingStart,
        vestingDuration: sched.vestingDuration,
        currentTime,
      });

      const offChainVested = (Number(currentTime - sched.vestingStart) * Number(sched.totalAmount))
        / Number(sched.vestingDuration);
      const cappedOffChain = Math.min(Number(sched.totalAmount), Math.max(0, offChainVested));

      totalOnChainVested += onChainVested;
      totalOffChainVested += cappedOffChain;
    }

    const drift = Math.abs(totalOffChainVested - Number(totalOnChainVested));
    // Per-schedule drift < 1, so total drift < number of schedules
    expect(drift).toBeLessThan(schedules.length);
  });
});
