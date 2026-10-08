/**
 * Focused GraphQL authentication-context security regression.
 * Extracts only the isolated context function from the real Apollo server
 * module so the test needs no database, listener or GraphQL schema bootstrap.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadContext(authService) {
  const source = fs.readFileSync(
    path.join(__dirname, '../src/graphql/server.js'), 'utf8'
  );
  expect(source).toContain('context: authenticatedGraphQLContext');
  const start = source.indexOf('const authenticatedGraphQLContext = async');
  const end = source.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('Apollo context function not found');
  return vm.runInNewContext(
    source.slice(start, end + 3) + '\nauthenticatedGraphQLContext',
    { authService }
  );
}

const tokenFromHeader = (req) => {
  const header = req.headers.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ')
    ? header.substring(7) : null;
};

test('does not authenticate spoofed user-address header or demo bearer tokens', async () => {
  const authService = {
    extractTokenFromHeader: jest.fn(tokenFromHeader),
    verifyAccessToken: jest.fn(async () => { throw new Error('invalid access token'); })
  };
  const context = loadContext(authService);
  const noBearer = await context({
    req: { headers: { 'x-user-address': 'GFAKEADMIN' } }, res: {}
  });
  const demo = await context({
    req: { headers: { authorization: 'Bearer admin-token' } }, res: {}
  });
  expect(noBearer.user).toBeNull();
  expect(demo.user).toBeNull();
  expect(authService.verifyAccessToken).toHaveBeenCalledTimes(1);
});

test('passes only verified access-token identity and role to vault middleware', async () => {
  const authService = {
    extractTokenFromHeader: jest.fn(tokenFromHeader),
    verifyAccessToken: jest.fn(async () => ({ address: 'GVERIFIEDWALLET', role: 'admin' }))
  };
  const context = loadContext(authService);
  const result = await context({
    req: { headers: { authorization: 'Bearer signed-access', 'x-user-address': 'GFORGED' } },
    res: {}
  });
  expect(result.user.address).toBe('GVERIFIEDWALLET');
  expect(result.user.role).toBe('admin');
  expect(authService.verifyAccessToken).toHaveBeenCalledWith('signed-access');
});

test('rejects invalid principal payloads and expired or refresh credentials', async () => {
  const authService = {
    extractTokenFromHeader: jest.fn(tokenFromHeader),
    verifyAccessToken: jest.fn()
      .mockResolvedValueOnce({ address: '', role: 'admin' })
      .mockRejectedValueOnce(new Error('invalid or expired token'))
  };
  const context = loadContext(authService);
  const makeRequest = () => ({ req: { headers: { authorization: 'Bearer bad-token' } }, res: {} });
  expect((await context(makeRequest())).user).toBeNull();
  expect((await context(makeRequest())).user).toBeNull();
});
