# API Versioning & Deprecation Policy

This document defines the official API versioning strategy, lifecycle stages, deprecation notice periods, and HTTP signaling headers for the Wavelum / Verinode Vesting Vault API.

---

## 1. URL Path Versioning Convention

All REST endpoints are versioned using explicit URI path prefixes configured via NestJS `@Controller({ version: '1' })` (`VersioningType.URI`) and Express routing middleware:

- **Version 1 (`v1`)**: `/api/v1/<resource>` (Current baseline stable version)
- **Version 2 (`v2`)**: `/api/v2/<resource>` (Next-generation endpoints with cursor pagination and real-time Soroban liquidity metadata)
- **Legacy Unversioned Paths (`/api/<resource>`)**: Automatically routed to `v1` for backward compatibility while emitting RFC 8594 `Deprecation` and `Sunset` headers.

Every versioned API response includes:
```http
X-API-Version: 1
```

---

## 2. API Version Lifecycle (`alpha` → `stable` → `deprecated` → `sunset`)

Each API version and endpoint transitions through four strictly defined lifecycle stages:

| Stage | Description | Breaking Changes | SLA & Support |
| :--- | :--- | :--- | :--- |
| **`alpha`** | Experimental preview endpoints for early partner feedback. | Permitted between minor releases with changelog notes. | Best-effort; not recommended for production critical paths. |
| **`stable`** | Production-ready contract locked in `openapi.json` (OpenAPI 3.1.0). | **Forbidden.** Breaking changes require introducing a new version (`/api/v2/...`). | Full production SLA and automated CI contract diff protection. |
| **`deprecated`** | Scheduled for retirement in favor of a newer API version. | Frozen; receives security and critical bug fixes only. | Remains operational for at least the **Minimum Deprecation Notice Period** (`90 days`). |
| **`sunset`** | Past the announced `Sunset` timestamp; endpoint is retired. | N/A | Returns `410 Gone` with a `Link` header pointing to the successor endpoint. |

---

## 3. Minimum Deprecation Notice Period

- **Stable APIs**: Minimum **90 calendar days** between the date an endpoint is marked `deprecated: true` and its `Sunset` retirement date.
- **Alpha / Preview APIs**: Minimum **30 calendar days** notice prior to removal.

---

## 4. Standard HTTP Deprecation & Sunset Headers (RFC 8594)

Whenever a client invokes a `deprecated` endpoint (such as `GET /api/v1/vaults` or an unversioned `/api/*` route), the server responds with standard IETF headers:

```http
HTTP/1.1 200 OK
X-API-Version: 1
Deprecation: true
Sunset: Wed, 30 Sep 2026 23:59:59 GMT
Link: </api/v2/vaults>; rel="successor-version", </docs/api-versioning.md>; rel="deprecation"
```

- **`Deprecation: true`**: Signals to automated SDK clients and API gateways that the endpoint is deprecated.
- **`Sunset: <HTTP-date>`**: RFC 8594 IMF-fixdate timestamp indicating the earliest point at which the endpoint may become unresponsive (`410 Gone`).
- **`Link`**: Provides the machine-readable `rel="successor-version"` replacement path and `rel="deprecation"` policy documentation link.

---

## 5. OpenAPI 3.1 Specification & Swagger UI Access

- **OpenAPI 3.1.0 Artifact**: Generated from NestJS controller/DTO decorators (`@ApiTags`, `@ApiOperation`, `@ApiParam`, `@ApiQuery`, `@ApiBody`, `@ApiResponse`, `@ApiProperty`, `@ApiDeprecated`) and route JSDoc definitions via `npm run swagger:generate` into `backend/openapi.json`.
- **Interactive Swagger UI (`/api/docs`)**:
  - Exposed at `/api/docs` (and JSON spec at `/api/docs.json`) in **development**, **staging**, and **test** environments only (`NODE_ENV !== 'production'`).
  - Protected behind auditor authentication middleware (`authenticateAuditor` in `backend/src/middleware/auditor.middleware.js`).
- **Automated Contract Diffing in CI**:
  - Pull requests are checked against the baseline OpenAPI 3.1 specification using `diffOpenApiSpecs` / `@redocly/cli` to block accidental removal of paths, operations, or `2xx` responses, or addition of required parameters without a version bump.
