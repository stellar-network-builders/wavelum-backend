// Mock the audit logger so slow-query writes don't touch the filesystem.
jest.mock('../services/auditLogger', () => ({ logSlowQuery: jest.fn() }));

const auditLogger = require('../services/auditLogger');
const monitor = require('./queryPerformanceMonitor');
const { QueryPerformanceMonitor } = monitor;

describe('QueryPerformanceMonitor', () => {
  let qpm;
  beforeEach(() => {
    jest.clearAllMocks();
    qpm = new QueryPerformanceMonitor({ slowQueryThresholdMs: 500 });
  });

  describe('deriveOperation', () => {
    it('tags select queries by table', () => {
      expect(qpm.deriveOperation('SELECT * FROM "vaults" WHERE id = 1')).toBe('select:vaults');
    });
    it('tags insert queries by table', () => {
      expect(qpm.deriveOperation('INSERT INTO claims (a) VALUES (1)')).toBe('insert:claims');
    });
    it('tags update queries by table', () => {
      expect(qpm.deriveOperation('UPDATE "tokens" SET x = 1')).toBe('update:tokens');
    });
    it('strips the Sequelize "Executing (default):" prefix', () => {
      expect(qpm.deriveOperation('Executing (default): SELECT * FROM beneficiaries')).toBe(
        'select:beneficiaries'
      );
    });
    it('falls back to unknown for empty sql', () => {
      expect(qpm.deriveOperation('')).toBe('unknown');
    });
  });

  describe('record', () => {
    it('accumulates per-operation stats', () => {
      qpm.record('SELECT * FROM vaults', 100);
      qpm.record('SELECT * FROM vaults', 300);
      const stats = qpm.getStats();
      expect(stats.totalQueries).toBe(2);
      expect(stats.operations['select:vaults'].count).toBe(2);
      expect(stats.operations['select:vaults'].avgMs).toBe(200);
      expect(stats.operations['select:vaults'].maxMs).toBe(300);
    });

    it('honours an explicit operation tag', () => {
      qpm.record('SELECT 1', 50, 'vault.getById');
      expect(qpm.getStats().operations['vault.getById'].count).toBe(1);
    });

    it('ignores non-numeric durations', () => {
      qpm.record('SELECT 1', undefined);
      expect(qpm.getStats().totalQueries).toBe(0);
    });
  });

  describe('slow query detection', () => {
    it('flags queries at/above the threshold and routes them to the audit channel', () => {
      qpm.record('SELECT * FROM big_table', 750);
      const stats = qpm.getStats();
      expect(stats.slowQueryCount).toBe(1);
      expect(auditLogger.logSlowQuery).toHaveBeenCalledTimes(1);
      const logged = auditLogger.logSlowQuery.mock.calls[0][0];
      expect(logged.durationMs).toBe(750);
      expect(logged.operation).toBe('select:big_table');
    });

    it('does not flag fast queries', () => {
      qpm.record('SELECT 1', 10);
      expect(qpm.getStats().slowQueryCount).toBe(0);
      expect(auditLogger.logSlowQuery).not.toHaveBeenCalled();
    });

    it('keeps a bounded buffer of recent slow queries (newest first)', () => {
      qpm.record('SELECT * FROM a', 600);
      qpm.record('SELECT * FROM b', 700);
      const recent = qpm.getSlowQueries();
      expect(recent[0].operation).toBe('select:b');
      expect(recent[1].operation).toBe('select:a');
    });
  });

  describe('createSequelizeLogger', () => {
    it('records timing passed by Sequelize benchmark mode', () => {
      const logger = qpm.createSequelizeLogger();
      logger('SELECT * FROM vaults', 250);
      expect(qpm.getStats().totalQueries).toBe(1);
    });

    it('invokes the passthrough logger without breaking on its errors', () => {
      const passthrough = jest.fn(() => {
        throw new Error('boom');
      });
      const logger = qpm.createSequelizeLogger(passthrough);
      expect(() => logger('SELECT 1', 5)).not.toThrow();
      expect(passthrough).toHaveBeenCalled();
    });
  });
});
