const { ApolloServer } = require('apollo-server-express');
const { typeDefs } = require('./schema');
const vestingTypeDefs = require('./vestingSchema');
const { vaultResolver } = require('./resolvers/vaultResolver');
const { userResolver } = require('./resolvers/userResolver');
const { proofResolver } = require('./resolvers/proofResolver');
const { anchorResolver } = require('./resolvers/anchorResolver');
const vestingResolvers = require('./vestingResolvers');
const capTableResolvers = require('./capTableResolvers');
const { authMiddleware, vaultAccessMiddleware } = require('./middleware/auth');
const { adaptiveRateLimitMiddleware } = require('./middleware/rateLimit');
const { depthLimitRule, costLimitRule, runtimeCostLimitPlugin } = require('./middleware/queryGuards');
const { makeExecutableSchema } = require('@graphql-tools/schema');
const { applyMiddleware } = require('graphql-middleware');
const authService = require('../services/authService');

// Share only principals cryptographically verified by the existing access-token
// verifier. Never promote user-supplied x-user-address or demonstration tokens
// into an authenticated GraphQL identity.
const authenticatedGraphQLContext = async ({ req, res }) => {
  const unauthenticated = { req, res, user: null };
  if (!req || !req.headers) return unauthenticated;
  const token = authService.extractTokenFromHeader(req);
  if (!token) return unauthenticated;
  try {
    const claims = await authService.verifyAccessToken(token);
    if (!claims || typeof claims.address !== 'string' || !claims.address.trim()) {
      return unauthenticated;
    }
    return {
      req,
      res,
      user: {
        address: claims.address.trim(),
        role: claims.role === 'admin' ? 'admin' : 'user'
      }
    };
  } catch (_) {
    // A malformed, expired, refresh, or invalidly signed token must not acquire
    // an identity. Existing guarded resolvers then reject anonymous callers.
    return unauthenticated;
  }
};

const resolvers = {
  Query: {
    ...vaultResolver.Query,
    ...userResolver.Query,
    ...proofResolver.Query,
    ...anchorResolver.Query,
    ...vestingResolvers.Query,
    ...capTableResolvers.Query
  },
  Mutation: {
    ...vaultResolver.Mutation,
    ...userResolver.Mutation,
    ...proofResolver.Mutation,
    ...vestingResolvers.Mutation,
    ...capTableResolvers.Mutation
  },
  Vault: vaultResolver.Vault,
  Beneficiary: userResolver.Beneficiary,
  VestingSchedule: vestingResolvers.VestingSchedule,
  VestingSummary: vestingResolvers.VestingSummary,
  ClaimHistory: vestingResolvers.ClaimHistory,
  VestingMilestone: vestingResolvers.VestingMilestone,
  VestingStatistics: vestingResolvers.VestingStatistics,
  VestingAnalytics: vestingResolvers.VestingAnalytics,
  BigDecimal: capTableResolvers.BigDecimal
};

const executableSchema = makeExecutableSchema({
  typeDefs: [typeDefs, vestingTypeDefs],
  resolvers
});

const schemaWithMiddleware = applyMiddleware(
  executableSchema,
  adaptiveRateLimitMiddleware,
  vaultAccessMiddleware
);

const createApolloServer = () => {
  return new ApolloServer({
    schema: schemaWithMiddleware,
    validationRules: [depthLimitRule(7), costLimitRule({ maxCost: 1000 })],
    plugins: [runtimeCostLimitPlugin({ maxCost: 1000 })],
    context: authenticatedGraphQLContext
  });
};

module.exports = { createApolloServer };
