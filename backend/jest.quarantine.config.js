const base = require('./jest.config');
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

module.exports = {
  ...base,
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: standardizedQuarantine.map((p) => `<rootDir>/${p}`),
};
