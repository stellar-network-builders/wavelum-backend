'use strict';

const {
  toBN,
  calculateVestedAmount,
  calculateStaticClaimable,
  calculateProportionalShare,
  calculateDynamicClaimable,
  sum,
} = require('../utils/highPrecisionMath');

describe('highPrecisionMath', () => {
  // ── toBN ──────────────────────────────────────────────────────────────────
  describe('toBN', () => {
    it('wraps a number', () => {
      expect(toBN(42).toNumber()).toBe(42);
    });

    it('wraps a numeric string', () => {
      expect(toBN('3.14').toString()).toBe('3.14');
    });

    it('wraps a BigNumber', () => {
      const bn = toBN('999');
      expect(toBN(bn).toNumber()).toBe(999);
    });

    it('throws on NaN', () => {
      expect(() => toBN('abc')).toThrow(RangeError);
    });

    it('throws on Infinity', () => {
      expect(() => toBN(Infinity)).toThrow(RangeError);
    });
  });

  // ── calculateVestedAmount ─────────────────────────────────────────────────
  describe('calculateVestedAmount', () => {
    const ONE_YEAR = 365 * 24 * 3600; // seconds

    it('returns 0 before vesting starts (elapsed ≤ 0)', () => {
      expect(calculateVestedAmount(1000, ONE_YEAR, 0).toNumber()).toBe(0);
      expect(calculateVestedAmount(1000, ONE_YEAR, -100).toNumber()).toBe(0);
    });

    it('returns full allocation when elapsed ≥ duration', () => {
      expect(calculateVestedAmount(1000, ONE_YEAR, ONE_YEAR).toNumber()).toBe(1000);
      expect(calculateVestedAmount(1000, ONE_YEAR, ONE_YEAR * 2).toNumber()).toBe(1000);
    });

    it('returns half allocation at midpoint', () => {
      const result = calculateVestedAmount(1000, ONE_YEAR, ONE_YEAR / 2);
      expect(result.toNumber()).toBe(500);
    });

    it('returns full allocation for zero-duration schedule', () => {
      expect(calculateVestedAmount(1000, 0, 0).toNumber()).toBe(1000);
    });

    it('handles fractional token amounts without floating-point error', () => {
      // 1/3 of 1 token over 3 seconds elapsed of 9 seconds
      const result = calculateVestedAmount('1', 9, 3);
      // Expected: 3/9 = 1/3 ≈ 0.333...
      expect(result.isGreaterThan('0.333')).toBe(true);
      expect(result.isLessThan('0.334')).toBe(true);
    });

    it('accepts string inputs', () => {
      expect(calculateVestedAmount('1000', String(ONE_YEAR), String(ONE_YEAR)).toNumber()).toBe(1000);
    });
  });

  // ── calculateStaticClaimable ──────────────────────────────────────────────
  describe('calculateStaticClaimable', () => {
    const ONE_YEAR = 365 * 24 * 3600;

    it('returns vested minus claimed', () => {
      // 6 months elapsed → 500 vested, 200 claimed → 300 claimable
      const result = calculateStaticClaimable(1000, ONE_YEAR, ONE_YEAR / 2, 200);
      expect(result.toNumber()).toBe(300);
    });

    it('returns 0 when claimed equals vested', () => {
      const result = calculateStaticClaimable(1000, ONE_YEAR, ONE_YEAR, 1000);
      expect(result.toNumber()).toBe(0);
    });

    it('floors at 0 (never negative)', () => {
      // claimed > vested
      const result = calculateStaticClaimable(1000, ONE_YEAR, ONE_YEAR / 2, 600);
      expect(result.toNumber()).toBe(0);
    });

    it('returns full allocation when fully vested and nothing claimed', () => {
      const result = calculateStaticClaimable(1000, ONE_YEAR, ONE_YEAR, 0);
      expect(result.toNumber()).toBe(1000);
    });
  });

  // ── calculateProportionalShare ────────────────────────────────────────────
  describe('calculateProportionalShare', () => {
    it('returns proportional share of actual balance', () => {
      // user vested 600 out of 1000 total, actual balance 900
      const result = calculateProportionalShare(600, 1000, 900);
      expect(result.toNumber()).toBe(540);
    });

    it('returns 0 when totalVested is 0', () => {
      expect(calculateProportionalShare(0, 0, 1000).toNumber()).toBe(0);
    });

    it('handles fee-reduced balances correctly', () => {
      // 10% fee: actual balance 900 instead of 1000
      const result = calculateProportionalShare(1000, 1000, 900);
      expect(result.toNumber()).toBe(900);
    });

    it('distributes proportionally among two beneficiaries', () => {
      const share1 = calculateProportionalShare(600, 1000, 900);
      const share2 = calculateProportionalShare(400, 1000, 900);
      expect(share1.plus(share2).toNumber()).toBe(900);
    });
  });

  // ── calculateDynamicClaimable ─────────────────────────────────────────────
  describe('calculateDynamicClaimable', () => {
    it('returns proportional share minus claimed', () => {
      // user vested 600/1000, actual 900 → share 540, claimed 100 → 440
      const result = calculateDynamicClaimable(600, 1000, 900, 100);
      expect(result.toNumber()).toBe(440);
    });

    it('floors at 0 when claimed exceeds share', () => {
      const result = calculateDynamicClaimable(600, 1000, 900, 600);
      expect(result.toNumber()).toBe(0);
    });

    it('returns 0 when totalVested is 0', () => {
      expect(calculateDynamicClaimable(0, 0, 1000, 0).toNumber()).toBe(0);
    });
  });

  // ── sum ───────────────────────────────────────────────────────────────────
  describe('sum', () => {
    it('sums an array of numbers', () => {
      expect(sum([100, 200, 300]).toNumber()).toBe(600);
    });

    it('sums an array of strings', () => {
      expect(sum(['0.1', '0.2', '0.3']).toNumber()).toBeCloseTo(0.6, 10);
    });

    it('returns 0 for empty array', () => {
      expect(sum([]).toNumber()).toBe(0);
    });

    it('avoids floating-point accumulation error', () => {
      // 0.1 + 0.2 in native JS = 0.30000000000000004
      const result = sum(['0.1', '0.2']);
      expect(result.toString()).toBe('0.3');
    });
  });

  // ── precision regression ──────────────────────────────────────────────────
  describe('precision regression', () => {
    it('does not accumulate dust over many small claims', () => {
      const ONE_YEAR = 365 * 24 * 3600;
      const allocation = '1000000'; // 1 million tokens
      let totalClaimed = toBN(0);

      // Simulate 12 monthly claims
      for (let month = 1; month <= 12; month++) {
        const elapsed = (ONE_YEAR / 12) * month;
        const vested = calculateVestedAmount(allocation, ONE_YEAR, elapsed);
        const claimable = vested.minus(totalClaimed);
        totalClaimed = totalClaimed.plus(claimable);
      }

      // After 12 months the full allocation should be claimed with no dust
      expect(totalClaimed.toString()).toBe('1000000');
    });
  });
});
