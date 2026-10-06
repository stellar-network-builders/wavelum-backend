const quarantine = require('./jest.quarantine');

// Escape a relative test path into a regex anchored at the end of the full path.
const toIgnorePattern = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';

// Default Jest configuration — the BLOCKING test run.
//
// Quarantined suites (see jest.quarantine.js) are excluded here so `npm test`
// reflects the health of the maintained suite and stays green. The quarantined
// suites still run, non-blocking, via `npm run test:quarantine` for burn-down.
module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: [
    '**/test/**/*.test.js',
    '**/tests/**/*.test.js',
    '**/?(*.)+(spec|test).js'
  ],
  testPathIgnorePatterns: ['/node_modules/', ...quarantine.map(toIgnorePattern)],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/index.js'
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 65,
      lines: 70,
      statements: 70
    }
  },
  maxWorkers: '50%',
  bail: false
};
