#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const VERSION = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?`;
const REGISTRY_RANGE = new RegExp(`^\\^?${VERSION}$`);
const LOCAL_REFERENCE = /^(?:file:|link:|workspace:).+$/;
const PACKAGES = { root: '.', backend: 'backend' };

function inspect(manifest, lock) {
  const errors = [];
  const locked = lock.packages?.[''];
  if (![2, 3].includes(lock.lockfileVersion) || !locked) {
    errors.push('A package-lock v2/v3 with root package metadata is required.');
  }
  for (const field of FIELDS) {
    const declared = manifest[field] || {};
    const recorded = locked?.[field] || {};
    for (const [name, spec] of Object.entries(declared)) {
      if (typeof spec !== 'string' || (!REGISTRY_RANGE.test(spec) && !LOCAL_REFERENCE.test(spec))) {
        errors.push(`${field}.${name}: unsupported dependency range ${JSON.stringify(spec)}; use an exact version or compatible caret range.`);
      }
    }
    for (const name of new Set([...Object.keys(declared), ...Object.keys(recorded)])) {
      if (declared[name] !== recorded[name]) {
        errors.push(`${field}.${name}: manifest=${declared[name] ?? '(absent)'}, lock=${recorded[name] ?? '(absent)'}`);
      }
    }
  }
  for (const field of ['name', 'version']) {
    if (manifest[field] !== locked?.[field]) errors.push(`Root ${field} differs between manifest and lock.`);
  }

  const packages = Object.entries(lock.packages || {})
    .filter(([location, metadata]) => location && !metadata.link)
    .map(([location, metadata]) => ({
      location,
      name: metadata.name || location.split('node_modules/').at(-1),
      version: metadata.version || null,
      license: typeof metadata.license === 'string' ? metadata.license : metadata.license?.type || null,
      deprecated: metadata.deprecated || null,
    }));
  const copyleft = packages.filter(p => /\b(?:A?GPL)-/i.test(p.license || ''));
  const deprecated = packages.filter(p => p.deprecated);
  const unknownLicenses = packages.filter(p => !p.license);
  return { errors, packageCount: packages.length, copyleft, deprecated, unknownLicenses, packages };
}

function main(args) {
  const label = args[0];
  if (!Object.hasOwn(PACKAGES, label)) throw new Error('Usage: node scripts/dependency-audit.cjs root|backend');
  const repo = path.resolve(__dirname, '..');
  const dir = path.join(repo, PACKAGES[label]);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
  const report = { package: label, ...inspect(manifest, lock) };
  const reports = path.join(repo, 'dependency-reports');
  fs.mkdirSync(reports, { recursive: true });
  fs.writeFileSync(path.join(reports, `${label}.json`), JSON.stringify(report, null, 2) + '\n');
  const clean = value => String(value).replace(/[\r\n|]/g, ' ');
  const lines = [
    `### Dependency inventory: ${label}`,
    '',
    `Locked packages: ${report.packageCount}; deprecated: ${report.deprecated.length}; GPL/AGPL license expressions: ${report.copyleft.length}; unspecified licenses: ${report.unknownLicenses.length}.`,
    '',
    'License/deprecation results are informational, not a compatibility approval. Review dual-license expressions and missing metadata manually.',
    '',
    '| Package | Version | License | Deprecation |',
    '| --- | --- | --- | --- |',
    ...report.packages.filter(p => p.deprecated || report.copyleft.includes(p) || !p.license)
      .map(p => `| ${clean(p.name)} | ${clean(p.version)} | ${clean(p.license || 'unspecified')} | ${clean(p.deprecated || '')} |`),
  ];
  fs.writeFileSync(path.join(reports, `${label}.md`), lines.join('\n') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  console.log(`${label}: ${report.packageCount} locked packages, ${report.deprecated.length} deprecated, ${report.copyleft.length} GPL/AGPL expressions, ${report.unknownLicenses.length} unspecified licenses.`);
  if (report.errors.length) {
    console.error('Dependency policy violations:\n' + report.errors.join('\n'));
    process.exitCode = 1;
  }
}

module.exports = { inspect };
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
