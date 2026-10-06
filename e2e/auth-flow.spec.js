const { test, expect } = require('@playwright/test');

// End-to-end user journey for the JWT authentication lifecycle, exercised
// against the real backend HTTP API (booted by Playwright's `webServer`).
//
// These tests use the `request` fixture only — the backend is a JSON API with
// no browser UI to drive. The login endpoint issues a short-lived access token
// plus an httpOnly refresh-token cookie; the refresh endpoint rotates them.
//
// Note: the current backend does not yet perform on-chain SEP-10 signature
// verification (see the `TODO: Verify signature` in src/index.js), so any
// non-empty signature is accepted. The tests assert the behaviour that is
// actually implemented, not the aspirational SEP-10 challenge flow.

const TEST_ADDRESS = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN';
const TEST_SIGNATURE = '0xtest-signature-not-verified-by-backend';

test.describe('Authentication Flow E2E', () => {
  test('health endpoint reports OK', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBe('OK');
    expect(body.timestamp).toBeDefined();
  });

  test('rejects login with missing credentials', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: {} });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.success).toBeFalsy();
    expect(body.error).toContain('Address and signature are required');
  });

  test('rejects access to a protected route without a token', async ({ request }) => {
    const res = await request.get('/api/auth/me');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.success).toBeFalsy();
    expect(body.error).toContain('Access token required');
  });

  test('rejects access to a protected route with an invalid token', async ({ request }) => {
    const res = await request.get('/api/auth/me', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.success).toBeFalsy();
  });

  test('rejects token refresh without a refresh token', async ({ request }) => {
    const res = await request.post('/api/auth/refresh');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.success).toBeFalsy();
    expect(body.error).toContain('Refresh token required');
  });

  test('completes the full login → protected route → refresh lifecycle', async ({ playwright }) => {
    // Use an isolated request context so the refresh-token cookie set by login
    // is stored and automatically replayed on the refresh call.
    const ctx = await playwright.request.newContext({ baseURL: 'http://localhost:4000' });

    // Step 1: log in.
    const loginRes = await ctx.post('/api/auth/login', {
      data: { address: TEST_ADDRESS, signature: TEST_SIGNATURE },
    });
    expect(loginRes.ok()).toBeTruthy();
    const login = await loginRes.json();
    expect(login.success).toBeTruthy();
    expect(login.data.accessToken).toBeDefined();
    expect(login.data.tokenType).toBe('Bearer');
    expect(login.data.expiresIn).toBeDefined();
    const accessToken = login.data.accessToken;

    // Step 2: access a protected route with the access token.
    const meRes = await ctx.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(meRes.ok()).toBeTruthy();
    const me = await meRes.json();
    expect(me.success).toBeTruthy();
    expect(me.data.address).toBe(TEST_ADDRESS);
    expect(me.data.role).toBeDefined();

    // Step 3: refresh the tokens using the httpOnly cookie from login.
    const refreshRes = await ctx.post('/api/auth/refresh');
    expect(refreshRes.ok()).toBeTruthy();
    const refresh = await refreshRes.json();
    expect(refresh.success).toBeTruthy();
    expect(refresh.data.accessToken).toBeDefined();

    // Step 4: the freshly issued access token works on the protected route.
    const meAgainRes = await ctx.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${refresh.data.accessToken}` },
    });
    expect(meAgainRes.ok()).toBeTruthy();
    const meAgain = await meAgainRes.json();
    expect(meAgain.success).toBeTruthy();
    expect(meAgain.data.address).toBe(TEST_ADDRESS);

    await ctx.dispose();
  });
});
