const fs = require('fs');
const path = require('path');

/**
 * Minimal Dependabot YAML parser for validating .github/dependabot.yml structure
 * and GitHub Actions ecosystem settings (Issue #33).
 */
function parseDependabotYaml(raw) {
  const lines = raw.split(/\r?\n/);
  const result = { version: null, updates: [] };
  let currentUpdate = null;
  let currentSection = null;
  let currentIgnoreItem = null;

  for (const rawLine of lines) {
    const withoutComment = rawLine.replace(/#.*$/, '');
    if (!withoutComment.trim()) continue;

    const versionMatch = withoutComment.match(/^version:\s*(\d+)\s*$/);
    if (versionMatch) {
      result.version = Number(versionMatch[1]);
      continue;
    }

    if (/^updates:\s*$/.test(withoutComment)) {
      continue;
    }

    const pkgMatch = withoutComment.match(/^\s*-\s*package-ecosystem:\s*"?([^"]+)"?\s*$/);
    if (pkgMatch) {
      currentUpdate = {
        'package-ecosystem': pkgMatch[1].trim(),
        schedule: {},
        labels: [],
        'commit-message': {},
        ignore: [],
      };
      result.updates.push(currentUpdate);
      currentSection = null;
      currentIgnoreItem = null;
      continue;
    }

    if (!currentUpdate) continue;

    const dirMatch = withoutComment.match(/^\s*directory:\s*"?([^"]+)"?\s*$/);
    if (dirMatch) {
      currentUpdate.directory = dirMatch[1].trim();
      continue;
    }

    const limitMatch = withoutComment.match(/^\s*open-pull-requests-limit:\s*(\d+)\s*$/);
    if (limitMatch) {
      currentUpdate['open-pull-requests-limit'] = Number(limitMatch[1]);
      continue;
    }

    if (/^\s*schedule:\s*$/.test(withoutComment)) {
      currentSection = 'schedule';
      continue;
    }

    if (/^\s*labels:\s*$/.test(withoutComment)) {
      currentSection = 'labels';
      continue;
    }

    if (/^\s*commit-message:\s*$/.test(withoutComment)) {
      currentSection = 'commit-message';
      continue;
    }

    if (/^\s*ignore:\s*$/.test(withoutComment)) {
      currentSection = 'ignore';
      continue;
    }

    if (currentSection === 'schedule') {
      const kv = withoutComment.match(/^\s+([a-z-]+):\s*"?([^"]+)"?\s*$/);
      if (kv) {
        currentUpdate.schedule[kv[1]] = kv[2].trim();
      }
    } else if (currentSection === 'labels') {
      const item = withoutComment.match(/^\s*-\s*"?([^"]+)"?\s*$/);
      if (item) {
        currentUpdate.labels.push(item[1].trim());
      }
    } else if (currentSection === 'commit-message') {
      const kv = withoutComment.match(/^\s+([a-z-]+):\s*"?([^"]+)"?\s*$/);
      if (kv) {
        currentUpdate['commit-message'][kv[1]] = kv[2].trim();
      }
    } else if (currentSection === 'ignore') {
      const depMatch = withoutComment.match(/^\s*-\s*dependency-name:\s*"?([^"]+)"?\s*$/);
      if (depMatch) {
        currentIgnoreItem = { 'dependency-name': depMatch[1].trim() };
        currentUpdate.ignore.push(currentIgnoreItem);
      }
    }
  }

  return result;
}

describe('Dependabot Configuration (.github/dependabot.yml)', () => {
  const dependabotPath = path.resolve(__dirname, '../../.github/dependabot.yml');

  test('file exists and specifies version 2', () => {
    expect(fs.existsSync(dependabotPath)).toBe(true);
    const raw = fs.readFileSync(dependabotPath, 'utf8');
    const parsed = parseDependabotYaml(raw);
    expect(parsed.version).toBe(2);
    expect(Array.isArray(parsed.updates)).toBe(true);
    expect(parsed.updates.length).toBeGreaterThanOrEqual(2);
  });

  test('configures github-actions ecosystem with weekly Monday 06:00 UTC schedule and limit 5', () => {
    const raw = fs.readFileSync(dependabotPath, 'utf8');
    const parsed = parseDependabotYaml(raw);
    const ghaEntry = parsed.updates.find(
      (u) => u['package-ecosystem'] === 'github-actions'
    );

    expect(ghaEntry).toBeDefined();
    expect(ghaEntry.directory).toBe('/');
    expect(ghaEntry.schedule).toEqual({
      interval: 'weekly',
      day: 'monday',
      time: '06:00',
      timezone: 'UTC',
    });
    expect(ghaEntry['open-pull-requests-limit']).toBe(5);
    expect(ghaEntry.labels).toEqual(expect.arrayContaining(['dependencies', 'ci']));
  });

  test('monitors npm dependencies across root and backend directories', () => {
    const raw = fs.readFileSync(dependabotPath, 'utf8');
    const parsed = parseDependabotYaml(raw);
    const npmDirs = parsed.updates
      .filter((u) => u['package-ecosystem'] === 'npm')
      .map((u) => u.directory);

    expect(npmDirs).toEqual(expect.arrayContaining(['/', '/backend']));
  });
});
