'use strict';

// PostgreSQL pg_lsn is a pair of 32-bit hexadecimal words, not a hex string
// with its slash removed. Keep the subtraction exact in BigInt.
function parseWalLsn(value) {
  const match = typeof value === 'string'
    ? /^([0-9a-f]{1,8})\/([0-9a-f]{1,8})$/i.exec(value)
    : null;
  if (!match) throw new Error('Invalid PostgreSQL WAL position');
  return (BigInt('0x' + match[1]) << 32n) + BigInt('0x' + match[2]);
}

function measureReplicationLag(masterPosition, replicaPosition, threshold) {
  if (!Number.isSafeInteger(threshold) || threshold < 0) {
    throw new Error('Invalid replication lag threshold');
  }
  const difference = parseWalLsn(masterPosition) - parseWalLsn(replicaPosition);
  if (difference < 0n) {
    return { lag: null, lagExceeded: true, error: 'Replica WAL is ahead of master WAL' };
  }
  // The JSON/Prometheus endpoints need ordinary numbers. Saturate an
  // enormous lag rather than losing the exact threshold decision to floats.
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  return {
    lag: Number(difference > limit ? limit : difference),
    lagExceeded: difference > BigInt(threshold),
    error: null
  };
}

module.exports = { parseWalLsn, measureReplicationLag };
