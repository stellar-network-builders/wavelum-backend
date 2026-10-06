const {
  buildPoolOptions,
  buildTimeoutDialectOptions,
  buildAdaptiveConfig,
  buildSequelizePoolConfig,
} = require('./poolConfig');

describe('poolConfig', () => {
  describe('buildPoolOptions', () => {
    it('returns tuned defaults that exceed Sequelize stock max:5', () => {
      const opts = buildPoolOptions({});
      expect(opts.max).toBe(20);
      expect(opts.min).toBe(2);
      expect(opts.acquire).toBe(30000);
      expect(opts.idle).toBe(10000);
      expect(opts.evict).toBe(5000);
    });

    it('honours environment overrides', () => {
      const opts = buildPoolOptions({
        DB_POOL_MAX: '40',
        DB_POOL_MIN: '5',
        DB_POOL_ACQUIRE_MS: '15000',
        DB_POOL_IDLE_MS: '8000',
        DB_POOL_EVICT_MS: '2000',
      });
      expect(opts).toEqual({ max: 40, min: 5, acquire: 15000, idle: 8000, evict: 2000 });
    });

    it('falls back to defaults on non-numeric input', () => {
      const opts = buildPoolOptions({ DB_POOL_MAX: 'not-a-number' });
      expect(opts.max).toBe(20);
    });
  });

  describe('buildTimeoutDialectOptions', () => {
    it('sets statement and idle-in-transaction timeouts with sane defaults', () => {
      const d = buildTimeoutDialectOptions({});
      expect(d.statement_timeout).toBe(30000);
      expect(d.idle_in_transaction_session_timeout).toBe(60000);
    });

    it('honours environment overrides', () => {
      const d = buildTimeoutDialectOptions({
        DB_STATEMENT_TIMEOUT_MS: '5000',
        DB_IDLE_IN_TX_TIMEOUT_MS: '10000',
      });
      expect(d.statement_timeout).toBe(5000);
      expect(d.idle_in_transaction_session_timeout).toBe(10000);
    });
  });

  describe('buildAdaptiveConfig', () => {
    it('provides bounded adaptive defaults', () => {
      const a = buildAdaptiveConfig({});
      expect(a.floor).toBe(2);
      expect(a.ceiling).toBe(50);
      expect(a.windowSize).toBe(12);
      expect(a.highWatermark).toBe(0.8);
      expect(a.lowWatermark).toBe(0.3);
      expect(a.step).toBe(2);
    });

    it('keeps ceiling strictly above floor even with odd config', () => {
      const a = buildAdaptiveConfig({ DB_POOL_MIN: '10', DB_POOL_ADAPTIVE_MAX: '4' });
      expect(a.ceiling).toBeGreaterThan(a.floor);
    });
  });

  describe('buildSequelizePoolConfig', () => {
    it('merges SSL dialect options with the timeout options', () => {
      const cfg = buildSequelizePoolConfig({ sslmode: 'require' }, {});
      expect(cfg.pool.max).toBe(20);
      expect(cfg.dialectOptions.sslmode).toBe('require');
      expect(cfg.dialectOptions.statement_timeout).toBe(30000);
    });
  });
});
