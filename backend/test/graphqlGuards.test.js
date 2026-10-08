/**
 * Focused tests for src/graphql/middleware/queryGuards.js.
 * Exercises the real validation rules through graphql-js `validate`
 * against a minimal schema — the rules are schema-agnostic, so this
 * covers the exact code wired into Apollo Server's `validationRules`.
 */
const { parse, buildSchema, validate } = require('graphql');
const { depthLimitRule, costLimitRule, runtimeCostLimitPlugin } = require('../src/graphql/middleware/queryGuards');

const schema = buildSchema(`
  type User { id: ID!, name: String, posts(first: Int): [Post], followers(first: Int): [User] }
  type Post { id: ID!, title: String, author: User }
  input PaginationInput { first: Int = 50, last: Int }
  type Query {
    user(id: ID!): User
    users(first: Int): [User]
    post(id: ID!): Post
    vestingHistory(pagination: PaginationInput): [Post]
    claimHistory(pagination: PaginationInput): [Post]
    searchVestingSchedules(pagination: PaginationInput): [Post]
  }
  type Mutation { createPost(title: String!): Post }
`);

const errors = (query, rules) => validate(schema, parse(query), rules).map((e) => e.message);

describe('depthLimitRule', () => {
  const rule = () => depthLimitRule(7);

  it('accepts shallow queries', () => {
    expect(errors('{ user { name } }', [rule()])).toEqual([]);
  });

  it('accepts depth exactly at the limit', () => {
    // user1 posts2 author3 posts4 author5 posts6 title7 = depth 7
    const q = '{ user { posts { author { posts { author { posts { title } } } } } } }';
    expect(errors(q, [rule()])).toEqual([]);
  });

  it('rejects queries deeper than the limit', () => {
    const q = '{ user { posts { author { posts { author { posts { author { title } } } } } } } }';
    const errs = errors(q, [rule()]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/maximum query depth of 7/);
    expect(errs[0]).toMatch(/depth: 8/);
  });

  it('rejects deeply nested queries at the first excess level', () => {
    // A long but syntactically valid tree must be rejected before its
    // remaining nested field selections are traversed.
    const nested = 'posts { '.repeat(80) + 'id' + ' }'.repeat(80);
    const result = errors('{ user { ' + nested + ' } }', [rule()]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/depth: 8/);
  });

  it('counts depth through fragment spreads', () => {
    const q = `
      { user { ...UserDeep } }
      fragment UserDeep on User { posts { author { posts { author { posts { author { title } } } } } } }
    `;
    expect(errors(q, [rule()])[0]).toMatch(/depth: 8/);
  });

  it('rejects recursive fragment cycles instead of hanging', () => {
    const q = `
      { user { ...A } }
      fragment A on User { posts { author { ...B } } }
      fragment B on User { posts { author { ...A } } }
    `;
    const errs = errors(q, [rule()]);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatch(/maximum query depth/);
  });

  it('names anonymous operations in the error', () => {
    const deep = '{ user { posts { author { posts { author { posts { author { id } } } } } } } }';
    expect(errors(deep, [rule()])[0]).toMatch(/anonymous/);
  });
});

describe('costLimitRule', () => {
  const rule = () => costLimitRule({ maxCost: 1000 });

  it('accepts ordinary queries under budget', () => {
    const q = '{ user { id name posts { title } } }';
    expect(errors(q, [rule()])).toEqual([]);
  });

  it('rejects wide queries over budget', () => {
    const parts = [];
    for (let i = 0; i < 1200; i += 1) parts.push(`f${i}: user { id }`);
    const q = `{ ${parts.join(' ')} }`;
    expect(errors(q, [rule()])[0]).toMatch(/maximum query cost of 1000/);
  });

  it('stops traversing expensive selections once the budget is exceeded', () => {
    // The operation is already over budget after the first 501 user/id pairs.
    // Accessing the per-field cost of later aliases would be unnecessary work.
    // The proxy detects a missing early cutoff without timing assertions.
    const costs = new Proxy({}, {
      get(_target, name) {
        if (typeof name === 'string' && /^f\d+$/.test(name) &&
            Number(name.slice(1)) > 1050) {
          throw new Error('Traversed fields after the cost budget was exceeded');
        }
        return undefined;
      }
    });
    const query = '{ ' + Array.from({ length: 1400 }, (_v, i) =>
      'f' + i + ': user { id }'
    ).join(' ') + ' }';
    const result = errors(query, [costLimitRule({ maxCost: 1000, fieldCosts: costs })]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/maximum query cost of 1000/);
  });

  it('multiplies subtree cost by list-size arguments', () => {
    // users(1) + name(1) + posts(1)+title(1) => subtree cost 4, x 600 = 2400
    const q = '{ users(first: 600) { name posts { title } } }';
    const errs = errors(q, [rule()]);
    expect(errs).toHaveLength(1);
    // Saturating at maxCost + 1 avoids traversing the rest of an expensive tree.
    expect(errs[0]).toMatch(/estimated cost: 1001/);
  });

  it('does not multiply when list args are small', () => {
    const q = '{ users(first: 10) { name } }'; // (1 + 1) * 10 = 20
    expect(errors(q, [rule()])).toEqual([]);
  });

  it('prices nested PaginationInput literals on vesting connection fields', () => {
    const leaves = Array.from({ length: 11 }, (_v, i) => 'p' + i + ': id').join(' ');
    const expensive = '{ vestingHistory(pagination: { first: 100 }) { ' + leaves + ' } }';
    expect(errors(expensive, [rule()])[0]).toMatch(/maximum query cost of 1000/);

    const bounded = '{ claimHistory(pagination: { first: 10 }) { id } }';
    expect(errors(bounded, [rule()])).toEqual([]);
  });

  it('charges the schema first=50 default on omitted and last-only pagination', () => {
    // 26 cost points * 50 default records = 1300; the old multiplier of
    // 1 (omitted) or 4 (last-only) allowed both over-budget operations.
    const fields = Array.from({ length: 25 }, (_v, i) => 'a' + i + ': id').join(' ');
    const noArg = '{ vestingHistory { ' + fields + ' } }';
    const lastOnly = '{ claimHistory(pagination: { last: 4 }) { ' + fields + ' } }';
    expect(errors(noArg, [rule()])[0]).toMatch(/maximum query cost of 1000/);
    expect(errors(lastOnly, [rule()])[0]).toMatch(/maximum query cost of 1000/);
    const explicit = '{ claimHistory(pagination: { first: 1, last: 4 }) { ' + fields + ' } }';
    expect(errors(explicit, [rule()])).toEqual([]);
  });

  it('honors per-field cost overrides', () => {
    const pricey = costLimitRule({ maxCost: 10, fieldCosts: { users: 50 } });
    expect(errors('{ users { id } }', [pricey])[0]).toMatch(/estimated cost/);
    const cheap = costLimitRule({ maxCost: 10 });
    expect(errors('{ user { id } }', [cheap])).toEqual([]);
  });

  it('applies to mutations as well as queries', () => {
    const wide = `{ ${Array.from({ length: 1200 }, (_, i) => `m${i}: createPost(title: "x") { id }`).join(' ')} }`;
    expect(errors(wide, [rule()])[0]).toMatch(/maximum query cost/);
  });
});


describe('runtimeCostLimitPlugin', () => {
  const runCostCheck = async (query, variables) => {
    const document = parse(query);
    const operation = document.definitions.find((d) => d.kind === 'OperationDefinition');
    const listener = await runtimeCostLimitPlugin({ maxCost: 1000 }).requestDidStart();
    return listener.didResolveOperation({ document, operation, request: { variables } });
  };

  it('allows a bounded variable but blocks oversized GraphQL pagination variables', async () => {
    const query = 'query Page($count: Int!) { users(first: $count) { id } }';
    // Static validation cannot see the caller's variables, so the Apollo
    // request-time hook must enforce the size before running resolvers.
    expect(errors(query, [costLimitRule({ maxCost: 1000 })])).toEqual([]);
    await expect(runCostCheck(query, { count: 10 })).resolves.toBeUndefined();
    await expect(runCostCheck(query, { count: 600 })).rejects.toThrow(/maximum query cost of 1000/);
  });


  it('rejects exponential acyclic fragment DAGs without expanding every occurrence', async () => {
    // 24 fragments, each spreading the previous fragment twice: only ~50 AST
    // spread nodes but over 16 million logical leaf occurrences.
    const fragments = ['fragment F0 on User { id }'];
    for (let level = 1; level <= 24; level += 1) {
      fragments.push(
        'fragment F' + level + ' on User { ...F' + (level - 1) +
        ' ...F' + (level - 1) + ' }'
      );
    }
    const query = 'query Shared { user(id: "1") { ...F24 } }\n' +
      fragments.join('\n');

    // Fragment reuse must not inflate the structural depth.
    expect(errors(query, [depthLimitRule(7)])).toEqual([]);
    // But each spread still contributes cost, even if its AST was memoized.
    const errs = errors(query, [costLimitRule({ maxCost: 1000 })]);
    expect(errs).toHaveLength(1);
    // The cost guard can stop once this request is irreversibly over budget.
    expect(errs[0]).toMatch(/estimated cost: 1001/);
    await expect(runCostCheck(query, {})).rejects.toThrow(/maximum query cost of 1000/);
  });

  it('prices nested pagination object variables, nested scalar variables, and object defaults', async () => {
    const objectVar =
      'query Page($page: PaginationInput!) { vestingHistory(pagination: $page) { id } }';
    expect(errors(objectVar, [costLimitRule({ maxCost: 1000 })])).toEqual([]);
    await expect(runCostCheck(objectVar, { page: { first: 10 } })).resolves.toBeUndefined();
    await expect(runCostCheck(objectVar, { page: { first: 600 } }))
      .rejects.toThrow(/maximum query cost of 1000/);

    const nestedScalar =
      'query Page($count: Int!) { claimHistory(pagination: { first: $count }) { id } }';
    await expect(runCostCheck(nestedScalar, { count: 10 })).resolves.toBeUndefined();
    await expect(runCostCheck(nestedScalar, { count: 600 }))
      .rejects.toThrow(/maximum query cost of 1000/);

    const objectDefault =
      'query Page($page: PaginationInput = { first: 600 }) { ' +
      'searchVestingSchedules(pagination: $page) { id } }';
    await expect(runCostCheck(objectDefault, {}))
      .rejects.toThrow(/maximum query cost of 1000/);
  });

  it('charges omitted input-object defaults at runtime without rejecting explicit first', async () => {
    const fields = Array.from({ length: 25 }, (_v, i) => 'a' + i + ': id').join(' ');
    const absent = 'query Q { searchVestingSchedules { ' + fields + ' } }';
    await expect(runCostCheck(absent, {})).rejects.toThrow(/maximum query cost of 1000/);

    const withVariable = 'query Q($page: PaginationInput!) { ' +
      'vestingHistory(pagination: $page) { ' + fields + ' } }';
    await expect(runCostCheck(withVariable, { page: { last: 4 } }))
      .rejects.toThrow(/maximum query cost of 1000/);
    await expect(runCostCheck(withVariable, { page: { first: 1, last: 4 } }))
      .resolves.toBeUndefined();
  });

  it('honors default variable values but fails closed on missing list sizes', async () => {
    const withDefault = 'query Page($count: Int = 10) { users(first: $count) { id } }';
    await expect(runCostCheck(withDefault, {})).resolves.toBeUndefined();
    await expect(runCostCheck(withDefault, { count: 600 })).rejects.toThrow(/maximum query cost/);
    const missing = 'query Page($count: Int) { users(first: $count) { id } }';
    await expect(runCostCheck(missing, {})).rejects.toThrow(/maximum query cost/);
  });
});
