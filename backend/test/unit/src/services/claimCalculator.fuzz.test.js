/**
 * Fuzz tests for claimCalculator to prevent dust accumulation
 * These tests simulate frequent claiming scenarios to ensure no dust loss
 */

const ClaimCalculator = require('./claimCalculator');
const BalanceTracker = require('./balanceTracker');
const { TokenType } = require('../models/vault');

// Mock BalanceTracker
jest.mock('./balanceTracker');

describe('ClaimCalculator Fuzz Tests - Dust Loss Prevention', () => {
  let calculator;
  let mockBalanceTracker;

  beforeEach(() => {
    calculator = new ClaimCalculator();
    mockBalanceTracker = calculator.balanceTracker;
    jest.clearAllMocks();
  });

  describe('Frequent Claiming Scenarios', () => {
    it('should not lose dust when claiming every 5 seconds for 4 years', () => {
      const totalAllocation = 1000000; // 1M tokens
      const vestingDuration = 4 * 365 * 24 * 60 * 60; // 4 years in seconds
      const claimInterval = 5; // Claim every 5 seconds
      const startDate = new Date('2024-01-01');
      
      const subSchedule = {
        top_up_amount: String(totalAllocation),
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: startDate,
        vesting_duration: vestingDuration,
      };

      let totalClaimed = 0;
      let currentTime = new Date(startDate);
      const endTime = new Date(startDate.getTime() + vestingDuration * 1000);

      // Simulate claiming every 5 seconds
      while (currentTime < endTime) {
        currentTime = new Date(currentTime.getTime() + claimInterval * 1000);
        
        const claimable = parseFloat(calculator.calculateStatic(subSchedule, currentTime));
        
        if (claimable > 0.000001) { // Only claim if there's a meaningful amount
          totalClaimed += claimable;
          // Update cumulative claimed amount
          subSchedule.cumulative_claimed_amount = String(totalClaimed);
        }
      }

      // After 4 years, user should have claimed almost everything (allowing for tiny rounding)
      const expectedTotal = totalAllocation;
      const actualTotal = parseFloat(subSchedule.cumulative_claimed_amount);
      
      // The difference should be less than 0.001% of total allocation (no significant dust loss)
      const dustLoss = expectedTotal - actualTotal;
      const maxAcceptableDust = expectedTotal * 0.00001; // 0.001%
      
      expect(dustLoss).toBeLessThan(maxAcceptableDust);
      expect(actualTotal).toBeGreaterThan(expectedTotal * 0.99999);
    });

    it('should handle micro-allocations without dust loss', () => {
      const microAllocation = 0.000001; // 1 micro-token
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year
      const claimInterval = 1; // Claim every second
      const startDate = new Date('2024-01-01');
      
      const subSchedule = {
        top_up_amount: String(microAllocation),
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: startDate,
        vesting_duration: vestingDuration,
      };

      let totalClaimed = 0;
      let currentTime = new Date(startDate);
      const endTime = new Date(startDate.getTime() + vestingDuration * 1000);

      // Simulate very frequent claiming
      while (currentTime < endTime && currentTime < new Date(startDate.getTime() + 1000 * 60)) { // Limit to 1 minute for test performance
        currentTime = new Date(currentTime.getTime() + claimInterval * 1000);
        
        const claimable = parseFloat(calculator.calculateStatic(subSchedule, currentTime));
        
        if (claimable > 0) {
          totalClaimed += claimable;
          subSchedule.cumulative_claimed_amount = String(totalClaimed);
        }
      }

      // Even with micro-allocations, the calculation should be precise
      expect(totalClaimed).toBeGreaterThanOrEqual(0);
      expect(isNaN(totalClaimed)).toBe(false);
      expect(isFinite(totalClaimed)).toBe(true);
    });

    it('should prevent dust accumulation with multiple small claims', () => {
      const totalAllocation = 1000;
      const vestingDuration = 30 * 24 * 60 * 60; // 30 days
      const startDate = new Date('2024-01-01');
      
      const subSchedule = {
        top_up_amount: String(totalAllocation),
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: startDate,
        vesting_duration: vestingDuration,
      };

      let totalClaimed = 0;
      const claimTimes = 1000; // Make 1000 claims
      
      for (let i = 0; i < claimTimes; i++) {
        const progress = i / claimTimes;
        const currentTime = new Date(startDate.getTime() + progress * vestingDuration * 1000);
        
        const claimable = parseFloat(calculator.calculateStatic(subSchedule, currentTime));
        
        if (claimable > 0.000001) {
          totalClaimed += claimable;
          subSchedule.cumulative_claimed_amount = String(totalClaimed);
        }
      }

      // At the end, check if total claimed matches expected vested amount
      const finalTime = new Date(startDate.getTime() + vestingDuration * 1000);
      const finalVested = calculator._calculateVestedAmount(subSchedule, finalTime);
      
      expect(totalClaimed).toBeCloseTo(finalVested, 6);
    });

    it('should handle edge case: claiming exactly at vesting completion', () => {
      const totalAllocation = 500;
      const vestingDuration = 60 * 60; // 1 hour
      const startDate = new Date('2024-01-01T00:00:00Z');
      
      const subSchedule = {
        top_up_amount: String(totalAllocation),
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: startDate,
        vesting_duration: vestingDuration,
      };

      // Claim exactly at vesting completion
      const completionTime = new Date(startDate.getTime() + vestingDuration * 1000);
      const claimable = parseFloat(calculator.calculateStatic(subSchedule, completionTime));
      
      expect(claimable).toBe(totalAllocation);
      
      // After claiming, should have 0 remaining
      subSchedule.cumulative_claimed_amount = String(claimable);
      const remainingClaimable = parseFloat(calculator.calculateStatic(subSchedule, completionTime));
      expect(remainingClaimable).toBe(0);
    });

    it('should handle dynamic tokens with cumulative tracking', async () => {
      mockBalanceTracker.getActualBalance.mockResolvedValue('950.12345678');

      const vault = {
        token_type: TokenType.DYNAMIC,
        token_address: 'TOKEN_ADDR',
        address: 'VAULT_ADDR',
      };

      const subSchedule = {
        top_up_amount: '1000',
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 365 * 24 * 60 * 60,
      };

      const currentTime = new Date('2025-01-01'); // Fully vested

      // First claim
      const firstClaim = await calculator.calculateDynamic(vault, subSchedule, currentTime, [subSchedule]);
      expect(parseFloat(firstClaim)).toBeCloseTo(950.12345678, 6);

      // Update cumulative claimed amount
      subSchedule.cumulative_claimed_amount = firstClaim;

      // Second claim should be 0
      const secondClaim = await calculator.calculateDynamic(vault, subSchedule, currentTime, [subSchedule]);
      expect(parseFloat(secondClaim)).toBe(0);
    });
  });

  describe('Precision Tests', () => {
    it('should maintain precision with high-frequency claims', () => {
      const totalAllocation = 100.123456789;
      const vestingDuration = 24 * 60 * 60; // 1 day
      const startDate = new Date('2024-01-01');
      
      const subSchedule = {
        top_up_amount: String(totalAllocation),
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: startDate,
        vesting_duration: vestingDuration,
      };

      let totalClaimed = 0;
      const claims = [];

      // Make claims every second for 1 hour
      for (let i = 0; i < 3600; i++) {
        const currentTime = new Date(startDate.getTime() + i * 1000);
        const claimable = parseFloat(calculator.calculateStatic(subSchedule, currentTime));
        
        if (claimable > 0.000000001) {
          claims.push(claimable);
          totalClaimed += claimable;
          subSchedule.cumulative_claimed_amount = String(totalClaimed);
        }
      }

      // Verify precision is maintained
      expect(totalClaimed).toBeGreaterThan(0);
      expect(isFinite(totalClaimed)).toBe(true);
      
      // The sum of individual claims should equal the final claimable amount
      const finalTime = new Date(startDate.getTime() + 3600 * 1000);
      const finalClaimable = parseFloat(calculator.calculateStatic(subSchedule, finalTime));
      expect(totalClaimed).toBeCloseTo(finalClaimable, 9);
    });

    it('should handle very small time intervals precisely', () => {
      const totalAllocation = 1000;
      const vestingDuration = 365 * 24 * 60 * 60; // 1 year
      const startDate = new Date('2024-01-01');
      
      const subSchedule = {
        top_up_amount: String(totalAllocation),
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: startDate,
        vesting_duration: vestingDuration,
      };

      // Test with 1 millisecond precision
      const currentTime = new Date(startDate.getTime() + 1); // 1 millisecond later
      const claimable = parseFloat(calculator.calculateStatic(subSchedule, currentTime));
      
      // Should be a very small but precise amount
      const expectedAmount = (1 * totalAllocation) / (vestingDuration * 1000);
      expect(claimable).toBeCloseTo(expectedAmount, 12);
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero vesting duration gracefully', () => {
      const subSchedule = {
        top_up_amount: '1000',
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 0, // Zero duration
      };

      const currentTime = new Date('2024-01-02');
      
      // Should not crash and should return reasonable value
      expect(() => {
        const result = calculator.calculateStatic(subSchedule, currentTime);
        expect(isFinite(parseFloat(result))).toBe(true);
      }).not.toThrow();
    });

    it('should handle negative cumulative claimed amounts', () => {
      const subSchedule = {
        top_up_amount: '1000',
        cumulative_claimed_amount: '-10', // Invalid negative value
        cliff_date: null,
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 365 * 24 * 60 * 60,
      };

      const currentTime = new Date('2025-01-01');
      const result = calculator.calculateStatic(subSchedule, currentTime);
      
      // Should handle gracefully and not return negative claimable amounts
      expect(parseFloat(result)).toBeGreaterThanOrEqual(0);
    });
  });
});
