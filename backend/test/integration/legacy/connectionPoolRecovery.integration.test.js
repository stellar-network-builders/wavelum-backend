/**
 * Integration test (issue #8): validates that the connection pool monitor
 * detects connection-pool exhaustion and that the pool recovers afterwards.
 *
 * Rather than depend on a live Postgres instance, this drives the monitor with
 * a simulated pool through three phases — healthy, exhausted, recovered — and
 * asserts the adaptive sizing reacts to pressure and then relaxes once load
 * subsides, mirroring real pool-exhaustion-and-recovery behaviour.
 */
const { ConnectionPoolMonitor } = require('../src/database/connectionPoolMonitor');

/**
 * Minimal stand-in for a connection pool that can be saturated and drained.
 * Mirrors the sequelize-pool surface (using / available / waiting / maxSize).
 */
class SimulatedPool {
  constructor(maxSize) {
    this.maxSize = maxSize;
    this.minSize = 2;
    this.using = 0;
    this.available = maxSize;
    this.waiting = 0;
    this.size = 0;
  }

  // Saturate every connection and queue `queued` extra requests (exhaustion).
  exhaust(queued = 0) {
    this.using = this.maxSize;
    this.available = 0;
    this.waiting = queued;
    this.size = this.maxSize;
  }

  // Return to an idle, fully-recovered state.
  recover() {
    this.using = 0;
    this.available = this.maxSize;
    this.waiting = 0;
    this.size = this.maxSize;
  }
}

describe('Connection pool recovery (integration)', () => {
  const adaptiveConfig = {
    floor: 4,
    ceiling: 20,
    windowSize: 3,
    highWatermark: 0.8,
    lowWatermark: 0.3,
    step: 4,
  };

  function drive(monitor, ticks) {
    for (let i = 0; i < ticks; i++) monitor.tick();
  }

  it('detects exhaustion, scales up, then recovers and scales back down', () => {
    const pool = new SimulatedPool(8);
    const applied = [];
    const monitor = new ConnectionPoolMonitor({
      adaptiveConfig,
      resize: (max) => applied.push(max),
    });
    monitor.attachPool(pool);

    // Phase 1 — healthy/idle: no growth expected.
    pool.recover();
    drive(monitor, adaptiveConfig.windowSize - 1);
    expect(monitor.recommendedMax).toBe(8);

    // Phase 2 — exhaustion: all connections in use with a backlog of waiters.
    pool.exhaust(6);
    drive(monitor, adaptiveConfig.windowSize);
    expect(monitor.recommendedMax).toBeGreaterThan(8); // grew under pressure
    expect(applied[applied.length - 1]).toBe(monitor.recommendedMax);

    const peak = monitor.recommendedMax;
    expect(monitor.getPoolStats().waiting).toBe(6); // exhaustion observed

    // Phase 3 — recovery: load drains, monitor should relax toward the floor.
    pool.recover();
    for (let round = 0; round < 10; round++) drive(monitor, adaptiveConfig.windowSize);

    expect(monitor.getPoolStats().waiting).toBe(0); // recovered
    expect(monitor.getPoolStats().idle).toBe(pool.maxSize);
    expect(monitor.recommendedMax).toBeLessThan(peak); // scaled back down
    expect(monitor.recommendedMax).toBeGreaterThanOrEqual(adaptiveConfig.floor);
  });

  it('never recommends a size outside the configured [floor, ceiling] bounds', () => {
    const pool = new SimulatedPool(8);
    const monitor = new ConnectionPoolMonitor({ adaptiveConfig });
    monitor.attachPool(pool);

    // Hammer with sustained exhaustion well beyond the ceiling.
    pool.exhaust(50);
    for (let round = 0; round < 20; round++) {
      for (let i = 0; i < adaptiveConfig.windowSize; i++) monitor.tick();
    }
    expect(monitor.recommendedMax).toBeLessThanOrEqual(adaptiveConfig.ceiling);

    // Then sustained idle well below the floor.
    pool.recover();
    for (let round = 0; round < 20; round++) {
      for (let i = 0; i < adaptiveConfig.windowSize; i++) monitor.tick();
    }
    expect(monitor.recommendedMax).toBeGreaterThanOrEqual(adaptiveConfig.floor);
  });
});
