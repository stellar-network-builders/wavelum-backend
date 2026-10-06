#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const ignoredDirectories = new Set([
  '.git',
  'node_modules',
  'coverage',
  'playwright-report',
  'test-results',
]);
const allowedRoots = [
  path.join(repoRoot, 'backend', 'test', 'unit') + path.sep,
  path.join(repoRoot, 'backend', 'test', 'integration') + path.sep,
  path.join(repoRoot, 'e2e') + path.sep,
];
const standardName = /(?:\.test|\.spec)\.(?:js|jsx|ts|tsx)$/i;
const legacyName = /_tests\.(?:js|jsx|ts|tsx)$/i;

const violations = [];
let discovered = 0;

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!entry.isFile()) continue;

    const testLike = standardName.test(entry.name) || legacyName.test(entry.name);
    if (!testLike) continue;
    discovered += 1;

    const relative = path.relative(repoRoot, absolute).split(path.sep).join('/');
    if (legacyName.test(entry.name)) {
      violations.push(`${relative}: rename *_tests.* to *.test.* or *.spec.*`);
      continue;
    }
    if (!allowedRoots.some((root) => absolute.startsWith(root))) {
      violations.push(`${relative}: test must live under backend/test/unit, backend/test/integration, or e2e`);
    }
  }
}

walk(repoRoot);

if (violations.length) {
  console.error('Test structure violations:');
  for (const violation of violations.sort()) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(`Test structure OK: ${discovered} standardized test files`);
