const monitor = require('./connectionPoolMonitor');
const { ConnectionPoolMonitor } = monitor;

// A mutable fake of the sequelize-pool surface used by the monitor.
function fakePool(overrides = {}) {
  return {
    using: 0,
    available: 0,
    waiting: 0,
    size: 0,
    maxSize: 4,
    minSize: 1,
    ...overrides,
  };
}

const ADAPTIVE = {
  floor: 2,
  ceiling: 10,
  windowSize: 3,
  highWatermark: 0.8,
  lowWatermark: 0.3,
  step: 2,
};

describe('ConnectionPoolMonitor', () => {
  describe('getPoolStats', () => {
    it('normalizes the pool snapshot and computes utilization', () => {
      const m = new ConnectionPoolMonitor({ adaptiveConfig: ADAPTIVE });
      m.attachPool(fakePool({ using: 3, available: 1, waiting: 2, size: 4, maxSize: 4 }));
      const s = m.getPoolStats();
      expect(s.active).toBe(3);
      expect(s.idle).toBe(1);
      expect(s.waiting).toBe(2);
      expect(s.max).toBe(4);
      expect(s.utilization).toBe(0.75);
    });

    it('reports detached state when no pool is attached', () => {
      const m = new ConnectionPoolMonitor({ adaptiveConfig: ADAPTIVE });
      expect(m.getPoolStats().attached).toBe(false);
    });
  });

  describe('adaptive sizing', () => {
    it('does not adjust while the window is warming up', () => {
      const resize = jest.fn();
      const m = new ConnectionPoolMonitor({ adaptiveConfig: ADAPTIVE, resize });
      m.attachPool(fakePool({ using: 4, maxSize: 4 }));
      m.tick(); // 1 sample
      m.tick(); // 2 samples (< windowSize 3)
      expect(resize).not.toHaveBeenCalled();
      expect(m.recommendedMax).toBe(4);
    });

    it('scales UP under sustained high utilization, capped at the ceiling', () => {
      const resize = jest.fn();
      const m = new ConnectionPoolMonitor({ adaptiveConfig: ADAPTIVE, resize });
      m.attachPool(fakePool({ using: 4, maxSize: 4 })); // utilization 1.0
      for (let i = 0; i < ADAPTIVE.windowSize; i++) m.tick();
      expect(m.recommendedMax).toBe(6); // 4 + step(2)
      expect(resize).toHaveBeenCalledWith(6, ADAPTIVE.floor);

      // Keep pushing pressure until it hits and stops at the ceiling.
      for (let round = 0; round < 10; round++) {
        for (let i = 0; i < ADAPTIVE.windowSize; i++) m.tick();
      }
      expect(m.recommendedMax).toBe(ADAPTIVE.ceiling);
    });

    it('scales DOWN when mostly idle, floored at the minimum', () => {
      const resize = jest.fn();
      const m = new ConnectionPoolMonitor({ adaptiveConfig: ADAPTIVE, resize });
      m.attachPool(fakePool({ using: 0, available: 8, maxSize: 8 })); // utilization 0
      for (let round = 0; round < 10; round++) {
        for (let i = 0; i < ADAPTIVE.windowSize; i++) m.tick();
      }
      expect(m.recommendedMax).toBe(ADAPTIVE.floor);
    });

    it('treats queued waiters as backpressure that forces growth', () => {
      const resize = jest.fn();
      const m = new ConnectionPoolMonitor({ adaptiveConfig: ADAPTIVE, resize });
      // 50% utilization but a full queue of waiters -> pressure > highWatermark.
      m.attachPool(fakePool({ using: 2, waiting: 4, maxSize: 4 }));
      for (let i = 0; i < ADAPTIVE.windowSize; i++) m.tick();
      expect(m.recommendedMax).toBe(6);
    });
  });

  describe('getStatus', () => {
    it('exposes pool snapshot, adaptive config and running flag', () => {
      const m = new ConnectionPoolMonitor({ adaptiveConfig: ADAPTIVE });
      m.attachPool(fakePool({ using: 1, maxSize: 4 }));
      const status = m.getStatus();
      expect(status.attached).toBe(true);
      expect(status.adaptive.ceiling).toBe(10);
      expect(status.running).toBe(false);
    });
  });
});
