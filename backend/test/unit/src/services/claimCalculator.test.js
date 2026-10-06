/**
 * Tests for ClaimCalculator service
 */

const ClaimCalculator = require('./claimCalculator');
const BalanceTracker = require('./balanceTracker');
const { TokenType } = require('../models/vault');
const { OverflowError, DivisionByZeroError } = require('../errors/VaultErrors');

// Mock BalanceTracker
jest.mock('./balanceTracker');

describe('ClaimCalculator', () => {
  let calculator;
  let mockBalanceTracker;

  beforeEach(() => {
    calculator = new ClaimCalculator();
    mockBalanceTracker = calculator.balanceTracker;
    jest.clearAllMocks();
  });

  describe('calculateStatic', () => {
    it('should calculate claimable amount for static tokens', () => {
      const subSchedule = {
        top_up_amount: '1000',
        cumulative_claimed_amount: '200', // Updated to use cumulative_claimed_amount
        cliff_date: null,
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 365 * 24 * 60 * 60, // 1 year in seconds
      };

      const currentTime = new Date('2024-07-01'); // 6 months later

      const result = calculator.calculateStatic(subSchedule, currentTime);

      // After 6 months, ~500 should be vested, minus 200 claimed = ~300 claimable
      const resultNum = parseFloat(result);
      expect(resultNum).toBeGreaterThan(290);
      expect(resultNum).toBeLessThan(310);
    });

    it('should return 0 if nothing is claimable', () => {
      const subSchedule = {
        top_up_amount: '1000',
        cumulative_claimed_amount: '1000', // Updated to use cumulative_claimed_amount
        cliff_date: null,
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 365 * 24 * 60 * 60,
      };

      const currentTime = new Date('2025-01-01');

      const result = calculator.calculateStatic(subSchedule, currentTime);
      expect(result).toBe('0');
    });

    it('should return 0 before cliff date', () => {
      const subSchedule = {
        top_up_amount: '1000',
        cumulative_claimed_amount: '0', // Updated to use cumulative_claimed_amount
        cliff_date: new Date('2024-06-01'),
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 365 * 24 * 60 * 60,
      };

      const currentTime = new Date('2024-03-01'); // Before cliff

      const result = calculator.calculateStatic(subSchedule, currentTime);
      expect(result).toBe('0');
    });
  });

  describe('calculateDynamic', () => {
    it('should calculate proportional share based on actual balance', async () => {
      // Mock actual balance query
      mockBalanceTracker.getActualBalance.mockResolvedValue('900'); // 10% fee applied

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

      const allSubSchedules = [subSchedule];
      const currentTime = new Date('2025-01-01'); // Fully vested

      const result = await calculator.calculateDynamic(
        vault,
        subSchedule,
        currentTime,
        allSubSchedules
      );

      // Should get proportional share of actual balance (900)
      expect(result).toBe('900');
    });

    it('should handle division by zero when total_vested is zero', async () => {
      mockBalanceTracker.getActualBalance.mockResolvedValue('1000');

      const vault = {
        token_type: TokenType.DYNAMIC,
        token_address: 'TOKEN_ADDR',
        address: 'VAULT_ADDR',
      };

      const subSchedule = {
        top_up_amount: '1000',
        cumulative_claimed_amount: '0', // Updated to use cumulative_claimed_amount
        cliff_date: null,
        vesting_start_date: new Date('2025-01-01'), // Future start date
        vesting_duration: 365 * 24 * 60 * 60,
      };

      const currentTime = new Date('2024-01-01'); // Before vesting starts

      const result = await calculator.calculateDynamic(
        vault,
        subSchedule,
        currentTime,
        [subSchedule]
      );

      // Should return 0 when nothing has vested
      expect(result).toBe('0');
    });

    it('should ensure result is non-negative', async () => {
      mockBalanceTracker.getActualBalance.mockResolvedValue('500');

      const vault = {
        token_type: TokenType.DYNAMIC,
        token_address: 'TOKEN_ADDR',
        address: 'VAULT_ADDR',
      };

      const subSchedule = {
        top_up_amount: '1000',
        cumulative_claimed_amount: '600', // Updated to use cumulative_claimed_amount
        cliff_date: null,
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 365 * 24 * 60 * 60,
      };

      const currentTime = new Date('2025-01-01'); // Fully vested

      const result = await calculator.calculateDynamic(
        vault,
        subSchedule,
        currentTime,
        [subSchedule]
      );

      // Should return 0, not negative
      expect(result).toBe('0');
    });

    it('should distribute proportionally among multiple beneficiaries', async () => {
      mockBalanceTracker.getActualBalance.mockResolvedValue('900'); // 10% fee

      const vault = {
        token_type: TokenType.DYNAMIC,
        token_address: 'TOKEN_ADDR',
        address: 'VAULT_ADDR',
      };

      const subSchedule1 = {
        top_up_amount: '600',
        cumulative_claimed_amount: '0', // Updated to use cumulative_claimed_amount
        cliff_date: null,
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 365 * 24 * 60 * 60,
      };

      const subSchedule2 = {
        top_up_amount: '400',
        cumulative_claimed_amount: '0', // Updated to use cumulative_claimed_amount
        cliff_date: null,
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 365 * 24 * 60 * 60,
      };

      const allSubSchedules = [subSchedule1, subSchedule2];
      const currentTime = new Date('2025-01-01'); // Fully vested

      const result1 = await calculator.calculateDynamic(
        vault,
        subSchedule1,
        currentTime,
        allSubSchedules
      );

      const result2 = await calculator.calculateDynamic(
        vault,
        subSchedule2,
        currentTime,
        allSubSchedules
      );

      // Beneficiary 1: (600/1000) * 900 = 540
      expect(parseFloat(result1)).toBeCloseTo(540, 1);

      // Beneficiary 2: (400/1000) * 900 = 360
      expect(parseFloat(result2)).toBeCloseTo(360, 1);

      // Total should equal actual balance
      const total = parseFloat(result1) + parseFloat(result2);
      expect(total).toBeCloseTo(900, 1);
    });
  });

  describe('calculateTotalVested', () => {
    it('should sum vested amounts across all subschedules', () => {
      const subSchedules = [
        {
          top_up_amount: '1000',
          cliff_date: null,
          vesting_start_date: new Date('2024-01-01'),
          vesting_duration: 365 * 24 * 60 * 60,
        },
        {
          top_up_amount: '500',
          cliff_date: null,
          vesting_start_date: new Date('2024-01-01'),
          vesting_duration: 365 * 24 * 60 * 60,
        },
      ];

      const currentTime = new Date('2025-01-01'); // Fully vested

      const total = calculator.calculateTotalVested(subSchedules, currentTime);

      expect(total).toBe(1500);
    });

    it('should return 0 for empty subschedules array', () => {
      const total = calculator.calculateTotalVested([], new Date());
      expect(total).toBe(0);
    });
  });

  describe('_safeMultiplyDivide', () => {
    it('should correctly calculate (a * b) / c', () => {
      const result = calculator._safeMultiplyDivide(100, 900, 1000);
      expect(result).toBe(90);
    });

    it('should throw DivisionByZeroError when divisor is zero', () => {
      expect(() => {
        calculator._safeMultiplyDivide(100, 900, 0);
      }).toThrow(DivisionByZeroError);
    });

    it('should throw OverflowError for infinite results', () => {
      expect(() => {
        calculator._safeMultiplyDivide(Number.MAX_VALUE, 2, 1);
      }).toThrow(OverflowError);
    });
  });

  describe('calculateClaimable', () => {
    it('should route to calculateStatic for static tokens', async () => {
      const vault = {
        token_type: TokenType.STATIC,
      };

      const subSchedule = {
        top_up_amount: '1000',
        cumulative_claimed_amount: '0',
        cliff_date: null,
        vesting_start_date: new Date('2024-01-01'),
        vesting_duration: 365 * 24 * 60 * 60,
      };

      const currentTime = new Date('2025-01-01');

      const result = await calculator.calculateClaimable(vault, subSchedule, currentTime);

      // Should use static calculation
      expect(result).toBe('1000');
      expect(mockBalanceTracker.getActualBalance).not.toHaveBeenCalled();
    });

    it('should route to calculateDynamic for dynamic tokens', async () => {
      mockBalanceTracker.getActualBalance.mockResolvedValue('900');

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

      const currentTime = new Date('2025-01-01');

      const result = await calculator.calculateClaimable(
        vault,
        subSchedule,
        currentTime,
        [subSchedule]
      );

      // Should use dynamic calculation
      expect(result).toBe('900');
      expect(mockBalanceTracker.getActualBalance).toHaveBeenCalled();
    });
  });
});
