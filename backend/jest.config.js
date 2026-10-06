const quarantine = require('./jest.quarantine');

const standardizePath = (p) => {
  if (p === 'e2e/auth-flow.spec.js') return null;
  if (p.startsWith('src/')) {
    const category = p.includes('.integration.test.js') || p.includes('.e2e.test.js')
      ? 'integration'
      : 'unit';
    return `test/${category}/${p.replace(/_tests\\.js$/, '.test.js')}`;
  }
  if (p.startsWith('test/')) {
    return `test/integration/legacy/${p.slice(5).replace(/_tests\\.js$/, '.test.js')}`;
  }
  return p;
};

const standardizedQuarantine = quarantine.map(standardizePath).filter(Boolean);
const toIgnorePattern = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$';

module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  resolver: '<rootDir>/test/standardizedResolver.js',
  testMatch: [
    '<rootDir>/test/unit/**/*.test.js',
    '<rootDir>/test/unit/**/*.spec.js',
    '<rootDir>/test/integration/**/*.test.js',
    '<rootDir>/test/integration/**/*.spec.js',
  ],
  testPathIgnorePatterns: ['/node_modules/', ...standardizedQuarantine.map(toIgnorePattern)],
  collectCoverageFrom: ['src/**/*.js', '!src/**/*.test.js', '!src/**/index.js'],
  maxWorkers: '50%',
  bail: false,
};
