# GraphQL Query Protection: Depth and Cost Limits

The GraphQL endpoint validates every incoming operation before execution.
Two limits apply, implemented in `src/graphql/middleware/queryGuards.js`
and wired into Apollo Server via `validationRules`.

## Depth limit

An operation may nest at most **7 levels** of fields, counted from the
operation root. Fragment spreads and inline fragments are resolved when
counting, so fragments cannot be used to hide depth. Recursive fragment
cycles are rejected. Rejected operations return
`Operation <name> exceeds the maximum query depth of 7`.

## Cost limit

An operation's estimated cost must not exceed **1000 points**:

- Every field costs 1 point by default.
- Numeric list-size arguments (`first`, `last`, `limit`, `take`,
  `pageSize`) multiply the cost of that field's whole subtree — e.g.
  `users(first: 600) { name posts { title } }` costs
  `(1 + 1 + (1 + 1)) * 600 = 2400`.
- The vesting connection fields `vestingHistory`, `claimHistory`, and
  `searchVestingSchedules` also price their nested `pagination: PaginationInput`
  object. `first`/`last` contribute the list multiplier; if the entire
  pagination argument or just its `first` member is omitted, the schema's
  `first: 50` default is charged. A `last: 4` object still inherits
  `first: 50`; only an explicit `first` overrides that default.
  Object literals are priced during validation, while object/scalar variables
  and GraphQL variable defaults are re-priced in the request-time hook.
- Field-level overrides can be registered in the `fieldCosts` map passed
  to `costLimitRule` for fields that are disproportionately expensive.
- Fragment spreads count their cost at each usage site; recursive cycles
  are rejected.

Rejected operations return
`Operation <name> exceeds the maximum query cost of 1000`.

The guard stops pricing later fields or repeated fragment references once the
operation already exceeds 1000 points, so an excessively wide query cannot
force a complete walk merely to calculate its exact rejected cost. The
`estimated cost` shown with a rejection is a **lower bound** (1001 when
truncated), not necessarily the full cost of an abusive operation. Both
validation-time literal arguments and the request-time variable-aware check
use this same budget cutoff; permitted queries retain exact cost calculation.

## Rate limiting

Per-field rate limiting already applies through
`middleware/rateLimit.js` (`adaptiveRateLimitMiddleware`): tiered budgets
for unauthenticated (50/15 min), user (200/15 min) and admin
(1000/15 min) traffic, with stricter tiers on expensive operations.
The depth/cost rules above run at validation time, before any resolver —
including rate-limit middleware — executes.


## Variable-size pagination safety

Static GraphQL validation can cost literal pagination arguments directly.
A query such as `query Page($count: Int!) { users(first: $count) { id } }`
does not expose `$count` to validation rules. The Apollo request-time
`didResolveOperation` hook therefore re-evaluates the selected operation
using supplied numeric variables (or integer defaults) **before resolvers**.
A bounded variable (e.g. `count: 10`) is allowed; `count: 600` on a
two-field query exceeds 1000 points and is rejected. Missing, invalid,
negative, or non-integer list-size variables fail closed instead of being
silently treated as multiplier 1. Non-pagination variables have no cost impact.

## Apollo Studio usage reporting (optional deployment configuration)

The GraphQL server in `src/graphql/server.js` uses **Apollo Server 3** (`apollo-server-express`). Apollo Server 3 already includes a built-in usage reporting plugin, automatically enabled when **both** of the following deployment environment variables are configured:

- `APOLLO_KEY`: a **graph/service** API key stored in the deployment's secret manager, not in source control or client code.
- `APOLLO_GRAPH_REF`: the graph and variant reference, for example `vesting-vault@production` (replace with the actual registered graph ref).

There is **no additional plugin or package to install** and no Apollo credentials are required to run the API without Studio. When the variables are absent, usage reporting is disabled. Setting only the key does not establish working reporting; configure both values. The default plugin redacts GraphQL variable values from usage traces (`sendVariableValues: { none: true }`); do not replace it with an all-values policy on an API handling wallets, vaults, or private claims.

The deployment owner can verify reporting in the appropriate Apollo Studio graph after starting the deployed server with both values, issuing a bounded non-sensitive GraphQL query, and allowing the normal batched reporting interval. This repository does **not** contain a deployed Studio key, registered graph ref, or proof of a live reporting receipt; do not describe reporting as active until the operator verifies ingestion. Keep the GraphQL depth (7), cost (1000), and rate limits enabled independently of Studio configuration.

Reference: [Apollo Server 3 usage reporting plugin](https://www.apollographql.com/docs/apollo-server/v3/api/plugin/usage-reporting/).
