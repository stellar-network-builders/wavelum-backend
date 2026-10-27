/**
 * API Versioning and Deprecation Policy Middleware (RFC 8594)
 *
 * Supports:
 * - Versioned API prefixes: `/api/v1/*` and `/api/v2/*`
 * - Legacy unversioned `/api/*` compatibility (rewritten internally while emitting deprecation headers)
 * - Standard RFC 8594 `Deprecation: true`, `Sunset: <HTTP-date>`, and `Link: <url>; rel="successor-version"` headers
 */

const MINIMUM_DEPRECATION_NOTICE_DAYS = 90;

const DEPRECATED_ROUTES = [
  {
    method: 'GET',
    pattern: /^\/api\/v1\/vaults\/?$/,
    sinceVersion: '1.0.0',
    sunsetDate: 'Wed, 30 Sep 2026 23:59:59 GMT',
    successorPath: '/api/v2/vaults',
    noticeDays: 90,
  },
];

function isSunsetNoticeValid(sunsetDateStr, minDays = MINIMUM_DEPRECATION_NOTICE_DAYS, referenceDate = new Date('2026-06-01T00:00:00Z')) {
  const sunsetTime = Date.parse(sunsetDateStr);
  if (Number.isNaN(sunsetTime)) return false;
  const diffDays = (sunsetTime - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= minDays;
}

function apiVersioningMiddleware(req, res, next) {
  const originalPath = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;

  const vMatch = /^\/api\/v([12])(\/.*)?$/.exec(originalPath);
  if (vMatch) {
    const version = vMatch[1];
    const subPath = vMatch[2] || '/';
    req.apiVersion = version;
    res.setHeader('X-API-Version', version);

    for (const rule of DEPRECATED_ROUTES) {
      if (
        (rule.method === '*' || rule.method === req.method.toUpperCase()) &&
        rule.pattern.test(originalPath)
      ) {
        res.setHeader('Deprecation', 'true');
        res.setHeader('Sunset', rule.sunsetDate);
        if (rule.successorPath) {
          res.setHeader(
            'Link',
            `<${rule.successorPath}>; rel="successor-version", </docs/api-versioning.md>; rel="deprecation"`
          );
        }
        break;
      }
    }

    // Rewrite `/api/v1/<route>` or `/api/v2/<route>` to `/api/<route>` so existing Express routers serve it seamlessly
    if (req.url.startsWith(`/api/v${version}`)) {
      req.url = `/api${subPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
    } else if (req.url.startsWith(`/v${version}`)) {
      req.url = `${subPath}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
    }
    return next();
  }

  // Legacy unversioned `/api/*` request (excluding `/api/docs` and `/api-docs`)
  if (
    originalPath.startsWith('/api/') &&
    !originalPath.startsWith('/api/docs') &&
    !originalPath.startsWith('/api-docs')
  ) {
    req.apiVersion = '1';
    res.setHeader('X-API-Version', '1');
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', 'Wed, 30 Sep 2026 23:59:59 GMT');
    const v1Successor = originalPath.replace(/^\/api\//, '/api/v1/');
    res.setHeader(
      'Link',
      `<${v1Successor}>; rel="successor-version", </docs/api-versioning.md>; rel="deprecation"`
    );
  }

  return next();
}

module.exports = {
  apiVersioningMiddleware,
  DEPRECATED_ROUTES,
  MINIMUM_DEPRECATION_NOTICE_DAYS,
  isSunsetNoticeValid,
};
