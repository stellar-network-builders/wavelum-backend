const fs = require('fs');
const path = require('path');
const { buildOpenApiSpec } = require('../src/swagger/options');
const {
  generateSwagger,
  diffOpenApiSpecs,
} = require('../src/swagger/swaggerGenerator');
const {
  apiVersioningMiddleware,
  MINIMUM_DEPRECATION_NOTICE_DAYS,
  isSunsetNoticeValid,
} = require('../src/middleware/apiVersioning.middleware');

describe('Issue #15 — OpenAPI 3.1 Documentation, Versioned API Paths & Deprecation Policy', () => {
  const spec = buildOpenApiSpec();

  test('generates an OpenAPI 3.1.0 specification with JSON Schema 3.1 dialect', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.jsonSchemaDialect).toBe('https://spec.openapis.org/oas/3.1/dialect/base');
    expect(spec.info.title).toBe('Verinode Vesting Vault API');
    expect(spec.servers.some((s) => s.url.endsWith('/api/v1'))).toBe(true);
    expect(spec.servers.some((s) => s.url.endsWith('/api/v2'))).toBe(true);
  });

  test('extracts NestJS controller routes and DTO schemas via decorators', () => {
    expect(spec.paths['/api/v1/vaults']).toBeDefined();
    expect(spec.paths['/api/v1/vaults'].get).toBeDefined();
    expect(spec.paths['/api/v1/vaults'].get.deprecated).toBe(true);
    expect(spec.paths['/api/v1/vaults'].post).toBeDefined();
    expect(spec.paths['/api/v1/vaults/{id}']).toBeDefined();
    expect(spec.paths['/api/v1/vaults/{id}/claims']).toBeDefined();
    expect(spec.paths['/api/v2/vaults']).toBeDefined();
    expect(spec.paths['/api/v2/vaults'].get).toBeDefined();
    expect(spec.paths['/api/v2/vaults'].get.deprecated).toBeUndefined();

    const schemas = spec.components.schemas;
    expect(schemas.VaultDto).toBeDefined();
    expect(schemas.CreateVaultDto).toBeDefined();
    expect(schemas.ClaimRequestDto).toBeDefined();
    expect(schemas.ClaimResponseDto).toBeDefined();
    expect(schemas.IdentityLinkKeyDto).toBeDefined();
    expect(schemas.KycEvaluateDto).toBeDefined();
    expect(schemas.KycWebhookDto).toBeDefined();
    expect(schemas.ApiErrorResponseDto).toBeDefined();

    // OpenAPI 3.1 nullable array type syntax
    expect(schemas.VaultDto.properties.liquidityStatus.type).toEqual(['string', 'null']);
  });

  test('enforces RFC 8594 Deprecation, Sunset, and Link headers on deprecated v1 and legacy routes', () => {
    const headers = {};
    const reqV1 = {
      method: 'GET',
      originalUrl: '/api/v1/vaults?ownerAddress=GABC',
      path: '/api/v1/vaults',
      url: '/api/v1/vaults?ownerAddress=GABC',
    };
    const resV1 = {
      setHeader: (k, v) => {
        headers[k] = v;
      },
    };
    let nextCalled = false;
    apiVersioningMiddleware(reqV1, resV1, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(reqV1.apiVersion).toBe('1');
    expect(reqV1.url).toBe('/api/vaults?ownerAddress=GABC');
    expect(headers['X-API-Version']).toBe('1');
    expect(headers.Deprecation).toBe('true');
    expect(headers.Sunset).toBe('Wed, 30 Sep 2026 23:59:59 GMT');
    expect(headers.Link).toContain('</api/v2/vaults>; rel="successor-version"');
    expect(isSunsetNoticeValid(headers.Sunset, MINIMUM_DEPRECATION_NOTICE_DAYS)).toBe(true);
  });

  test('detects breaking OpenAPI contract changes without a version bump', () => {
    const baseline = buildOpenApiSpec();
    const nonBreaking = buildOpenApiSpec();
    expect(diffOpenApiSpecs(baseline, nonBreaking)).toEqual({
      breaking: false,
      issues: [],
    });

    const breakingRemovedPath = buildOpenApiSpec();
    delete breakingRemovedPath.paths['/api/v2/vaults'];
    const diff1 = diffOpenApiSpecs(baseline, breakingRemovedPath);
    expect(diff1.breaking).toBe(true);
    expect(diff1.issues[0]).toContain('Removed path "/api/v2/vaults"');

    const bumpedVersion = buildOpenApiSpec();
    bumpedVersion.info.version = '2.0.0';
    delete bumpedVersion.paths['/api/v1/vaults'];
    expect(diffOpenApiSpecs(baseline, bumpedVersion).breaking).toBe(false);
  });

  test('writes static openapi.json and verifies docs/api-versioning.md policy', () => {
    const outPath = path.resolve(__dirname, '../openapi.json');
    generateSwagger(outPath);
    expect(fs.existsSync(outPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    expect(written.openapi).toBe('3.1.0');

    const policyPath = path.resolve(__dirname, '../../docs/api-versioning.md');
    expect(fs.existsSync(policyPath)).toBe(true);
    const policy = fs.readFileSync(policyPath, 'utf8');
    expect(policy).toContain('alpha');
    expect(policy).toContain('stable');
    expect(policy).toContain('deprecated');
    expect(policy).toContain('sunset');
    expect(policy).toContain('90 calendar days');
    expect(policy).toContain('Deprecation: true');
    expect(policy).toContain('Sunset:');
  });
});
