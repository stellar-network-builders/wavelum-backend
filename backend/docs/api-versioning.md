# API Versioning & Deprecation Policy

See [`../docs/api-versioning.md`](../../docs/api-versioning.md) for the complete specification covering:

1. **Version Lifecycle**: `alpha` → `stable` → `deprecated` → `sunset`
2. **Minimum Deprecation Notice Period**: `90 days` for stable APIs
3. **Standard Headers**: `Deprecation: true`, `Sunset: <HTTP-date>`, and `Link: <url>; rel="successor-version"`
4. **URL Versioning**: `/api/v1/` and `/api/v2/` via NestJS `@Controller({ version: '1' })` and Express versioning middleware
5. **Swagger UI Security**: `/api/docs` restricted to non-production environments behind `auditor.middleware.js`
