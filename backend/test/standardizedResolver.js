const path = require('path');

const backendRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(backendRoot, '..');

const remaps = [
  [path.join(backendRoot, 'test', 'unit', 'src'), path.join(backendRoot, 'src')],
  [path.join(backendRoot, 'test', 'integration', 'src'), path.join(backendRoot, 'src')],
  [path.join(backendRoot, 'test', 'integration', 'legacy_cleanup'), path.join(repoRoot, 'legacy_cleanup', 'tests')],
  [path.join(backendRoot, 'test', 'integration', 'legacy'), path.join(backendRoot, 'test')],
  [path.join(backendRoot, 'test', 'unit', 'root-tests'), path.join(repoRoot, 'tests')],
  [path.join(backendRoot, 'test', 'unit', 'root'), repoRoot],
];

function originalBasedir(basedir) {
  const resolved = path.resolve(basedir);
  for (const [standardRoot, originalRoot] of remaps) {
    if (resolved === standardRoot || resolved.startsWith(standardRoot + path.sep)) {
      return path.join(originalRoot, path.relative(standardRoot, resolved));
    }
  }
  return resolved;
}

module.exports = (request, options) => {
  if (!request.startsWith('.')) return options.defaultResolver(request, options);
  const legacyBase = originalBasedir(options.basedir);
  if (legacyBase === path.resolve(options.basedir)) return options.defaultResolver(request, options);
  try {
    return options.defaultResolver(request, { ...options, basedir: legacyBase });
  } catch (legacyError) {
    try {
      return options.defaultResolver(request, options);
    } catch (_) {
      throw legacyError;
    }
  }
};
