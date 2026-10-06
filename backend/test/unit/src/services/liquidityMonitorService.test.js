jest.mock('axios');
jest.mock('./emailService', () => ({
  sendLiquidityRiskAlertEmail: jest.fn().mockResolvedValue(true),
}));
jest.mock('./firebaseService', () => ({
  isInitialized: jest.fn(() => true),
  sendLiquidityRiskAlertNotification: jest.fn().mockResolvedValue({
    successCount: 1,
    failureCount: 0,
  }),
}));
jest.mock('../models', () => ({
  Vault: {
    findAll: jest.fn(),
  },
  Beneficiary: {},
  Organization: {},
  Token: {
    findOne: jest.fn(),
  },
  DeviceToken: {
    findAll: jest.fn(),
  },
  VaultLiquidityAlert: {
    findOrCreate: jest.fn(),
  },
}));

const axios = require('axios');
const emailService = require('./emailService');
const firebaseService = require('./firebaseService');
const {
  Vault,
  Token,
  DeviceToken,
  VaultLiquidityAlert,
} = require('../models');
const liquidityMonitorService = require('./liquidityMonitorService');

describe('LiquidityMonitorService', () => {
  let state;

  beforeEach(() => {
    jest.clearAllMocks();

    process.env.LIQUIDITY_MONITOR_QUOTE_ASSET = 'USDC:GDUKMGUGDZQK6YH3QJ4M5V3Q5Y2EAFH6XWQ2XQWX7QAFMCH3YJ3S4NQF';
    process.env.LIQUIDITY_ALERT_ORDER_USD = '1000';
    process.env.LIQUIDITY_ALERT_MAX_SLIPPAGE = '0.05';

    state = {
      status: 'healthy',
      last_alerted_at: null,
      update: jest.fn().mockResolvedValue(true),
    };

    VaultLiquidityAlert.findOrCreate.mockResolvedValue([state, true]);
    Token.findOne.mockResolvedValue({ symbol: 'WAVE' });
    DeviceToken.findAll.mockResolvedValue([{ device_token: 'device-1' }]);
    liquidityMonitorService.quoteAsset = process.env.LIQUIDITY_MONITOR_QUOTE_ASSET;
    liquidityMonitorService.orderUsd = 1000;
    liquidityMonitorService.maxSlippage = 0.05;
  });

  it('calculates alerting status when simulated sell slippage exceeds the threshold', async () => {
    axios.get.mockResolvedValue({
      data: {
        bids: [
          { price: '1.00', amount: '500' },
          { price: '0.88', amount: '700' },
        ],
      },
    });

    const result = await liquidityMonitorService.evaluateVaultLiquidity(
      { token_address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', address: 'vault-1' },
      { symbol: 'WAVE' }
    );

    expect(result.status).toBe('alerting');
    expect(result.slippage).toBeGreaterThan(0.05);
    expect(result.insufficientDepth).toBe(false);
  });

  it('sends alerts only on the transition into alerting state', async () => {
    axios.get.mockResolvedValue({
      data: {
        bids: [
          { price: '1.00', amount: '500' },
          { price: '0.88', amount: '700' },
        ],
      },
    });

    Vault.findAll.mockResolvedValue([
      {
        id: 'vault-1',
        address: 'vault-1',
        name: 'Wave Seed',
        token_address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        owner_address: 'GFOUNDER',
        organization: { admin_address: 'GADMIN' },
        beneficiaries: [
          { address: 'GINVESTOR', email: 'investor@example.com' },
        ],
      },
    ]);

    const firstRun = await liquidityMonitorService.monitorAllVaults();
    expect(firstRun.alerted).toBe(1);
    expect(emailService.sendLiquidityRiskAlertEmail).toHaveBeenCalledTimes(1);
    expect(firebaseService.sendLiquidityRiskAlertNotification).toHaveBeenCalledTimes(1);

    state.status = 'alerting';
    const secondRun = await liquidityMonitorService.monitorAllVaults();
    expect(secondRun.alerted).toBe(0);
    expect(emailService.sendLiquidityRiskAlertEmail).toHaveBeenCalledTimes(1);
    expect(firebaseService.sendLiquidityRiskAlertNotification).toHaveBeenCalledTimes(1);
  });

  it('marks insufficient depth as alerting even when slippage cannot be fully computed', async () => {
    axios.get.mockResolvedValue({
      data: {
        bids: [
          { price: '1.00', amount: '400' },
        ],
      },
    });

    const result = await liquidityMonitorService.evaluateVaultLiquidity(
      { token_address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', address: 'vault-1' },
      { symbol: 'WAVE' }
    );

    expect(result.status).toBe('alerting');
    expect(result.insufficientDepth).toBe(true);
  });
});
