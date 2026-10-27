const fs = require('fs');
const path = require('path');
const { buildOpenApiSpec } = require('./options');

/**
 * Generates the static OpenAPI 3.1 JSON artifact (`backend/openapi.json`).
 * @param {string} [outputPath]
 * @returns {object} Generated OpenAPI 3.1 document
 */
function generateSwagger(outputPath) {
  const targetPath = outputPath || path.resolve(__dirname, '../../openapi.json');
  const spec = buildOpenApiSpec();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  return spec;
}

/**
 * Compares a baseline OpenAPI spec with a candidate OpenAPI spec to detect breaking changes
 * introduced without a version bump.
 *
 * Breaking changes detected:
 * 1. Removal of an existing stable (non-deprecated) path or HTTP operation without a major/minor version bump
 * 2. Addition of a new required query/path parameter to an existing operation on the same API version
 * 3. Removal of a documented 2xx success response status code from an existing operation
 *
 * @param {object} baselineSpec
 * @param {object} candidateSpec
 * @returns {{ breaking: boolean, issues: string[] }}
 */
function diffOpenApiSpecs(baselineSpec, candidateSpec) {
  const issues = [];
  const baseVersion = baselineSpec?.info?.version || '1.0.0';
  const candVersion = candidateSpec?.info?.version || '1.0.0';
  const versionBumped = baseVersion !== candVersion;

  const basePaths = baselineSpec?.paths || {};
  const candPaths = candidateSpec?.paths || {};

  for (const [routePath, methods] of Object.entries(basePaths)) {
    if (!candPaths[routePath]) {
      if (!versionBumped) {
        issues.push(`Removed path "${routePath}" without bumping info.version (${baseVersion}).`);
      }
      continue;
    }

    for (const [method, op] of Object.entries(methods)) {
      if (typeof op !== 'object' || op === null) continue;
      const candOp = candPaths[routePath][method];
      if (!candOp) {
        if (!op.deprecated && !versionBumped) {
          issues.push(
            `Removed non-deprecated operation "${method.toUpperCase()} ${routePath}" without bumping info.version (${baseVersion}).`
          );
        }
        continue;
      }

      // Check for newly required parameters on existing operations
      const baseParams = new Map(
        (op.parameters || []).map((p) => [`${p.in}:${p.name}`, Boolean(p.required)])
      );
      for (const param of candOp.parameters || []) {
        const key = `${param.in}:${param.name}`;
        const wasRequired = baseParams.get(key);
        if (param.required && !wasRequired && !versionBumped) {
          issues.push(
            `Added required parameter "${param.name}" (${param.in}) to "${method.toUpperCase()} ${routePath}" without version bump.`
          );
        }
      }

      // Check for removed 2xx responses
      const baseResponses = Object.keys(op.responses || {}).filter((code) => code.startsWith('2'));
      const candResponses = new Set(Object.keys(candOp.responses || {}));
      for (const statusCode of baseResponses) {
        if (!candResponses.has(statusCode) && !versionBumped) {
          issues.push(
            `Removed ${statusCode} response from "${method.toUpperCase()} ${routePath}" without version bump.`
          );
        }
      }
    }
  }

  return {
    breaking: issues.length > 0,
    issues,
  };
}

module.exports = {
  generateSwagger,
  diffOpenApiSpecs,
};
