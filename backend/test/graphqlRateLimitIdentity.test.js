jest.mock('express-rate-limit', () => {
  const middlewareFactory = jest.fn((options) => options);
  const ipKeyGenerator = jest.fn((ip) => {
    if (ip.startsWith('2001:db8:')) return '2001:db8::/56';
    return ip;
  });
  return { rateLimit: middlewareFactory, ipKeyGenerator };
});

const {
  trustedIpKey,
  rateLimiter,
  graphqlRateLimitMiddleware
} = require('../src/graphql/middleware/rateLimit');

describe('GraphQL / Express ingress rate-limit identity', () => {
  test('attacker-controlled user header cannot mint a new limiter bucket', () => {
    const middleware = rateLimiter({ max: 2 });
    const first = { ip: '203.0.113.9', headers: { 'x-user-address': 'alice' } };
    const second = { ip: '203.0.113.9', headers: { 'x-user-address': 'bob' } };
    expect(middleware.keyGenerator(first)).toBe('ip:203.0.113.9');
    expect(middleware.keyGenerator(second)).toBe('ip:203.0.113.9');
  });

  test('rotating arbitrary bearer tokens cannot evade the IP quota', () => {
    const middleware = rateLimiter();
    expect(middleware.keyGenerator({ ip: '198.51.100.17', headers: { authorization: 'Bearer token-a' } }))
      .toBe(middleware.keyGenerator({ ip: '198.51.100.17', headers: { authorization: 'Bearer token-b' } }));
  });

  test('untrusted X-Forwarded-For is not a fallback identity', () => {
    const first = { headers: { 'x-forwarded-for': '8.8.8.8' } };
    const second = { headers: { 'x-forwarded-for': '1.1.1.1' } };
    expect(trustedIpKey(first)).toBe('ip:unknown');
    expect(trustedIpKey(second)).toBe('ip:unknown');
  });

  test('IPv6 privacy-address rotation stays in the same subnet bucket', () => {
    expect(trustedIpKey({ ip: '2001:db8:face:1::11' }))
      .toBe(trustedIpKey({ ip: '2001:db8:face:1::12' }));
  });

  test('handler never treats spoofed header as authentication', () => {
    const options = rateLimiter();
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    options.handler({ headers: { 'x-user-address': '0xspoofed' } }, { status, json });
    expect(status).toHaveBeenCalledWith(429);
    expect(json.mock.calls[0][0].rateLimitInfo.userType).toBe('anonymous');
  });

  test('resolver limiter counts rotated spoofed headers in one anonymous IP bucket', async () => {
    const middleware = graphqlRateLimitMiddleware({ max: 1 });
    const context = { user: null, req: { ip: '203.0.113.29', headers: { 'x-user-address': 'one' } } };
    const resolve = jest.fn(() => 'ok');
    expect(await middleware(resolve, null, {}, context, {})).toBe('ok');
    context.req.headers['x-user-address'] = 'another';
    await expect(middleware(resolve, null, {}, context, {}))
      .rejects.toMatchObject({ extensions: { code: 'RATE_LIMIT_EXCEEDED' } });
    expect(resolve).toHaveBeenCalledTimes(1);
  });
});
