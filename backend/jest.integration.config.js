const quarantine = require('./jest.quarantine');

const standardizedQuarantine = quarantine
  .filter((p) => p !== 'e2e/auth-flow.spec.js')
  .map((p) => {
    if (p.startsWith('src/')) {
      const category = p.includes('.integration.test.js') || p.includes('.e2e.test.js') ? 'integration' : 'unit';
      return `test/${category}/${p.replace(/_tests\.js$/, '.test.js')}`;
    }
    if (p.startsWith('test/')) return `test/integration/legacy/${p.slice(5).replace(/_tests\.js$/, '.test.js')}`;
    return p;
  });

module.exports = {
  displayName: 'integration',
  rootDir: '.',
  testEnvironment: 'node',
  testTimeout: 60000,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  resolver: '<rootDir>/test/standardizedResolver.js',
  testMatch: ['<rootDir>/test/integration/**/*.test.js', '<rootDir>/test/integration/**/*.spec.js'],
  testPathIgnorePatterns: ['/node_modules/', ...standardizedQuarantine],
  collectCoverageFrom: ['src/**/*.js', '!src/**/*.test.js', '!src/**/index.js'],
  maxWorkers: '50%',
  bail: false,
};
