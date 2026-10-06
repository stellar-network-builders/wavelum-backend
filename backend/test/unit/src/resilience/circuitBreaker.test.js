// Keep the registry's side-effects (Slack alerts, DB failover) out of these
// unit tests; metric recording is exercised against the real registry.
jest.mock('../services/slackWebhookService', () => ({
  sendCircuitBreakerAlert: jest.fn().mockResolvedValue(true),
  sendCircuitBreakerDigest: jest.fn().mockResolvedValue(true)
}));
jest.mock('../services/databaseFailoverService', () => ({
  emergencyReadFromMaster: jest.fn().mockResolvedValue(true)
}));

const CircuitBreaker = require('./circuitBreaker');
const registry = require('./circuitBreakerRegistry');
const metricsService = require('../services/metricsService');
const slackWebhookService = require('../services/slackWebhookService');
const databaseFailoverService = require('../services/databaseFailoverService');

const fail = () => Promise.reject(new Error('boom'));
const ok = () => Promise.resolve('ok');

const expectReject = (p) => expect(p).rejects.toThrow();

/** Drive a breaker straight to OPEN by exhausting its failure threshold. */
async function trip(cb, name = 'op') {
  const threshold = cb.options.failureThreshold;
  for (let i = 0; i < threshold; i++) {
    await expectReject(cb.execute(fail, { name }));
  }
}

describe('CircuitBreaker', () => {
  describe('state transitions', () => {
    it('starts CLOSED and opens once the failure threshold is reached', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3, resetTimeout: 10000 });
      expect(cb.getState().state).toBe('CLOSED');

      await trip(cb);

      expect(cb.getState().state).toBe('OPEN');
      expect(cb.getState().trips).toBe(1);
    });

    it('fast-fails with CIRCUIT_BREAKER_OPEN while OPEN', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000 });
      await trip(cb);

      await expect(cb.execute(ok, { name: 'op' })).rejects.toMatchObject({
        code: 'CIRCUIT_BREAKER_OPEN'
      });
    });

    it('flows CLOSED -> OPEN -> HALF_OPEN -> CLOSED on recovery', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000, halfOpenMinSuccesses: 1 });
      await trip(cb);
      expect(cb.getState().state).toBe('OPEN');

      // Allow the reset window to elapse so the next call probes (HALF_OPEN).
      cb.nextAttempt = Date.now() - 1;
      const result = await cb.execute(ok, { name: 'op' });

      expect(result).toBe('ok');
      expect(cb.getState().state).toBe('CLOSED');
      expect(cb.getState().failureCount).toBe(0);
    });

    it('returns to OPEN if the half-open probe fails', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000 });
      await trip(cb);

      cb.nextAttempt = Date.now() - 1;
      await expectReject(cb.execute(fail, { name: 'op' }));

      expect(cb.getState().state).toBe('OPEN');
      expect(cb.getState().trips).toBe(2);
    });
  });

  describe('half-open minimum probe count', () => {
    it('requires halfOpenMinSuccesses consecutive successes before closing', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeout: 10000, halfOpenMinSuccesses: 2 });
      await trip(cb);

      cb.nextAttempt = Date.now() - 1;
      await cb.execute(ok, { name: 'op' }); // first probe — not enough yet
      expect(cb.getState().state).toBe('HALF_OPEN');

      await cb.execute(ok, { name: 'op' }); // second probe — closes
      expect(cb.getState().state).toBe('CLOSED');
    });
  });

  describe('manual control', () => {
    it('forceOpen / forceClose move the circuit without traffic', () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });
      cb.forceOpen();
      expect(cb.getState().state).toBe('OPEN');
      cb.forceClose();
      expect(cb.getState().state).toBe('CLOSED');
    });
  });
});

describe('CircuitBreakerRegistry', () => {
  beforeEach(() => {
    registry.clear();
    jest.clearAllMocks();
  });

  it('returns the same breaker instance per service', () => {
    const a = registry.getOrCreate('svcShared');
    const b = registry.getOrCreate('svcShared');
    expect(a).toBe(b);
  });

  it('isolates one failing service from the others', async () => {
    const a = registry.getOrCreate('svcA', { failureThreshold: 1, resetTimeout: 10000 });
    const b = registry.getOrCreate('svcB', { failureThreshold: 1, resetTimeout: 10000 });

    await expectReject(a.execute(fail, { name: 'a' }));

    expect(a.getState().state).toBe('OPEN');
    expect(b.getState().state).toBe('CLOSED');
  });

  it('records Prometheus metrics on every state change', async () => {
    const cb = registry.getOrCreate('svcMetrics', { failureThreshold: 1, resetTimeout: 10000 });
    await expectReject(cb.execute(fail, { name: 'm' }));

    const data = await metricsService.circuitBreakerState.get();
    const valueFor = (state) =>
      data.values.find((v) => v.labels.service === 'svcMetrics' && v.labels.state === state)?.value;

    expect(valueFor('open')).toBe(1);
    expect(valueFor('closed')).toBe(0);
    expect(valueFor('half-open')).toBe(0);
  });

  it('alerts Slack when a circuit opens and closes', async () => {
    const cb = registry.getOrCreate('svcAlert', { failureThreshold: 1, resetTimeout: 10000 });

    await expectReject(cb.execute(fail, { name: 'x' }));
    expect(slackWebhookService.sendCircuitBreakerAlert).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'svcAlert', state: 'open' })
    );

    cb.nextAttempt = Date.now() - 1;
    await cb.execute(ok, { name: 'x' });
    expect(slackWebhookService.sendCircuitBreakerAlert).toHaveBeenCalledWith(
      expect.objectContaining({ service: 'svcAlert', state: 'closed' })
    );
  });

  it('triggers a database failover when a DB circuit opens', async () => {
    const cb = registry.getOrCreate('postgres', { failureThreshold: 1, resetTimeout: 10000 });
    await expectReject(cb.execute(fail, { name: 'db' }));

    expect(databaseFailoverService.emergencyReadFromMaster).toHaveBeenCalled();
  });

  it('reset() closes a tripped circuit and reports unknown services', async () => {
    const cb = registry.getOrCreate('svcReset', { failureThreshold: 1, resetTimeout: 10000 });
    await expectReject(cb.execute(fail, { name: 'r' }));
    expect(cb.getState().state).toBe('OPEN');

    expect(registry.reset('svcReset')).toBe(true);
    expect(cb.getState().state).toBe('CLOSED');
    expect(registry.reset('does-not-exist')).toBe(false);
  });

  it('getAllStates() snapshots every registered circuit', () => {
    registry.getOrCreate('svc1');
    registry.getOrCreate('svc2');
    const states = registry.getAllStates();
    expect(states.map((s) => s.service).sort()).toEqual(['svc1', 'svc2']);
    expect(states[0]).toHaveProperty('state');
    expect(states[0]).toHaveProperty('trips');
  });
});
