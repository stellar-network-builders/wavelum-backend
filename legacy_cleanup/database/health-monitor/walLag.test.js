'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { parseWalLsn, measureReplicationLag } = require('./walLag');

test('handles the exact high-word carry across PostgreSQL WAL positions', () => {
  const measured = measureReplicationLag('1/00000000', '0/FFFFFFFF', 1);
  assert.equal(measured.lag, 1);
  assert.equal(measured.lagExceeded, false);
  assert.equal(measured.error, null);
});

test('keeps one-word lag and near-maximum WAL precision', () => {
  assert.equal(parseWalLsn('1/2') - parseWalLsn('0/2'), 4294967296n);
  const measured = measureReplicationLag('FFFFFFFF/FFFFFFFF', 'FFFFFFFF/FFFFFFF0', 14);
  assert.equal(measured.lag, 15);
  assert.equal(measured.lagExceeded, true);
});

test('reports unreasonably large lag conservatively to JSON consumers', () => {
  const measured = measureReplicationLag('FFFFFFFF/FFFFFFFF', '0/0', 1000);
  assert.equal(measured.lag, Number.MAX_SAFE_INTEGER);
  assert.equal(measured.lagExceeded, true);
});

test('fails closed for malformed or reversed replication topology', () => {
  assert.throws(() => parseWalLsn('1FFFFFFFF/1'), /Invalid PostgreSQL WAL/);
  assert.throws(() => parseWalLsn('01/z'), /Invalid PostgreSQL WAL/);
  assert.throws(() => measureReplicationLag('0/1', '0/0', -1), /lag threshold/);
  const reversed = measureReplicationLag('0/1', '0/2', 1000);
  assert.equal(reversed.lag, null);
  assert.equal(reversed.lagExceeded, true);
  assert.match(reversed.error, /ahead of master/);
});
