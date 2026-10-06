/**
 * Tests for BalanceTracker service
 */

// Mock axios before importing BalanceTracker
jest.mock('axios');

const BalanceTracker = require('./balanceTracker');
const { BalanceQueryFailedError } = require('../errors/VaultErrors');
const axios = require('axios');

describe('BalanceTracker', () => {
  let balanceTracker;
  
  beforeEach(() => {
    jest.clearAllMocks();
    balanceTracker = new BalanceTracker('https://soroban-testnet.stellar.org');
  });

  describe('constructor', () => {
    it('should use provided RPC URL', () => {
      const customUrl = 'https://custom-rpc.stellar.org';
      const tracker = new BalanceTracker(customUrl);
      
      expect(tracker.rpcUrl).toBe(customUrl);
    });

    it('should use environment variable if no URL provided', () => {
      process.env.STELLAR_RPC_URL = 'https://env-rpc.stellar.org';
      const tracker = new BalanceTracker();
      
      expect(tracker.rpcUrl).toBe('https://env-rpc.stellar.org');
    });

    it('should use default testnet URL if no URL or env variable', () => {
      delete process.env.STELLAR_RPC_URL;
      const tracker = new BalanceTracker();
      
      expect(tracker.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    });
  });

  describe('getActualBalance', () => {
    const tokenAddress = 'CTOKEN123';
    const vaultAddress = 'GVAULT456';

    it('should query balance successfully and return as string', async () => {
      // Mock successful balance query
      const mockResponse = {
        data: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            result: {
              retval: {
                _value: 1000000
              }
            }
          }
        }
      };
      
      axios.post.mockResolvedValue(mockResponse);

      const balance = await balanceTracker.getActualBalance(tokenAddress, vaultAddress);

      expect(balance).toBe('1000000');
      expect(axios.post).toHaveBeenCalledWith(
        'https://soroban-testnet.stellar.org',
        expect.objectContaining({
          jsonrpc: '2.0',
          method: 'simulateTransaction'
        })
      );
    });

    it('should handle i128 balance values', async () => {
      // Mock i128 result
      const mockResponse = {
        data: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            result: {
              retval: {
                _switch: { name: 'scvI128' },
                i128: {
                  hi: 0,
                  lo: 5000000
                }
              }
            }
          }
        }
      };
      
      axios.post.mockResolvedValue(mockResponse);

      const balance = await balanceTracker.getActualBalance(tokenAddress, vaultAddress);

      expect(balance).toBe('5000000');
    });

    it('should throw BalanceQueryFailedError when query fails', async () => {
      axios.post.mockRejectedValue(new Error('Network error'));

      await expect(
        balanceTracker.getActualBalance(tokenAddress, vaultAddress)
      ).rejects.toThrow(BalanceQueryFailedError);
    });

    it('should throw BalanceQueryFailedError when result has error', async () => {
      const mockResponse = {
        data: {
          error: {
            message: 'Contract execution failed'
          }
        }
      };
      
      axios.post.mockResolvedValue(mockResponse);

      await expect(
        balanceTracker.getActualBalance(tokenAddress, vaultAddress)
      ).rejects.toThrow(BalanceQueryFailedError);
    });

    it('should throw BalanceQueryFailedError when result is empty', async () => {
      const mockResponse = {
        data: {
          jsonrpc: '2.0',
          id: 1
        }
      };
      
      axios.post.mockResolvedValue(mockResponse);

      await expect(
        balanceTracker.getActualBalance(tokenAddress, vaultAddress)
      ).rejects.toThrow(BalanceQueryFailedError);
    });
  });

  describe('verifyDeposit', () => {
    const tokenAddress = 'CTOKEN123';
    const vaultAddress = 'GVAULT456';

    it('should calculate actual received amount correctly', async () => {
      const balanceBefore = '1000000';
      
      // Mock balance after deposit (with 1% fee)
      const mockResponse = {
        data: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            result: {
              retval: {
                _value: 1990000 // 1000000 + 1000000 - 1% fee
              }
            }
          }
        }
      };
      
      axios.post.mockResolvedValue(mockResponse);

      const actualReceived = await balanceTracker.verifyDeposit(
        tokenAddress,
        vaultAddress,
        balanceBefore
      );

      expect(actualReceived).toBe('990000');
    });

    it('should handle numeric balanceBefore parameter', async () => {
      const balanceBefore = 1000000;
      
      const mockResponse = {
        data: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            result: {
              retval: {
                _value: 1500000
              }
            }
          }
        }
      };
      
      axios.post.mockResolvedValue(mockResponse);

      const actualReceived = await balanceTracker.verifyDeposit(
        tokenAddress,
        vaultAddress,
        balanceBefore
      );

      expect(actualReceived).toBe('500000');
    });

    it('should throw BalanceQueryFailedError when balance query fails', async () => {
      axios.post.mockRejectedValue(new Error('Network error'));

      await expect(
        balanceTracker.verifyDeposit(tokenAddress, vaultAddress, '1000000')
      ).rejects.toThrow(BalanceQueryFailedError);
    });

    it('should handle zero received amount (100% fee)', async () => {
      const balanceBefore = '1000000';
      
      // Balance stays the same (all tokens burned as fee)
      const mockResponse = {
        data: {
          jsonrpc: '2.0',
          id: 1,
          result: {
            result: {
              retval: {
                _value: 1000000
              }
            }
          }
        }
      };
      
      axios.post.mockResolvedValue(mockResponse);

      const actualReceived = await balanceTracker.verifyDeposit(
        tokenAddress,
        vaultAddress,
        balanceBefore
      );

      expect(actualReceived).toBe('0');
    });
  });

  describe('_extractBalanceFromResult', () => {
    it('should extract balance from retval._value', () => {
      const result = {
        result: {
          retval: {
            _value: 123456
          }
        }
      };

      const balance = balanceTracker._extractBalanceFromResult(result);
      expect(balance).toBe('123456');
    });

    it('should extract balance from numeric result', () => {
      const result = 789012;

      const balance = balanceTracker._extractBalanceFromResult(result);
      expect(balance).toBe('789012');
    });

    it('should extract balance from bigint result', () => {
      const result = BigInt(999999);

      const balance = balanceTracker._extractBalanceFromResult(result);
      expect(balance).toBe('999999');
    });

    it('should throw error for invalid result format', () => {
      const result = {
        invalid: 'format'
      };

      expect(() => balanceTracker._extractBalanceFromResult(result))
        .toThrow('Unable to extract balance from result');
    });
  });

  describe('_extractI128Value', () => {
    it('should extract i128 value when hi is 0', () => {
      const scval = {
        i128: {
          hi: 0,
          lo: 12345
        }
      };

      const value = balanceTracker._extractI128Value(scval);
      expect(value).toBe('12345');
    });

    it('should extract i128 value when hi is 0n (BigInt)', () => {
      const scval = {
        i128: {
          hi: 0n,
          lo: 67890
        }
      };

      const value = balanceTracker._extractI128Value(scval);
      expect(value).toBe('67890');
    });

    it('should combine hi and lo for full i128 value', () => {
      const scval = {
        i128: {
          hi: 1,
          lo: 0
        }
      };

      const value = balanceTracker._extractI128Value(scval);
      // 1 << 64 = 18446744073709551616
      expect(value).toBe('18446744073709551616');
    });

    it('should throw error for invalid i128 structure', () => {
      const scval = {
        notI128: true
      };

      expect(() => balanceTracker._extractI128Value(scval))
        .toThrow('Invalid i128 ScVal structure');
    });
  });
});
