const client = require('prom-client');

// Create a Registry which registers the metrics
const register = new client.Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'vesting-vault-backend'
});

// Enable the collection of default metrics
client.collectDefaultMetrics({ register });

// Custom metrics
const apiResponseTime = new client.Histogram({
  name: 'api_response_time_seconds',
  help: 'Response time of API endpoints in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 0.7, 1, 3, 5, 10]
});

const activeDbConnections = new client.Gauge({
  name: 'active_db_connections',
  help: 'Total number of active database connections'
});

const totalIndexedBlocks = new client.Gauge({
  name: 'total_indexed_ledger_blocks',
  help: 'Total number of ledger blocks indexed'
});

// Database connection pool metrics
const dbPoolIdleConnections = new client.Gauge({
  name: 'db_pool_idle_connections',
  help: 'Number of idle (available) connections in the database pool'
});

const dbPoolWaitingRequests = new client.Gauge({
  name: 'db_pool_waiting_requests',
  help: 'Number of requests waiting to acquire a database connection'
});

const dbPoolUtilization = new client.Gauge({
  name: 'db_pool_utilization_ratio',
  help: 'Database pool utilization (active connections / max connections, 0..1)'
});

const dbPoolMaxConnections = new client.Gauge({
  name: 'db_pool_max_connections',
  help: 'Configured maximum size of the database connection pool'
});

const dbSlowQueriesTotal = new client.Counter({
  name: 'db_slow_queries_total',
  help: 'Total number of database queries exceeding the slow-query threshold',
  labelNames: ['operation']
});

// RPC Health Metrics
const rpcEndpointHealth = new client.Gauge({
  name: 'soroban_rpc_endpoint_health',
  help: 'Health status of Soroban RPC endpoints (1=healthy, 0=unhealthy)',
  labelNames: ['endpoint', 'state']
});

const rpcHealthCheckLatency = new client.Histogram({
  name: 'soroban_rpc_health_check_latency_ms',
  help: 'Latency of Soroban RPC health checks in milliseconds',
  labelNames: ['endpoint'],
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
});

const rpcFailoverCount = new client.Counter({
  name: 'soroban_rpc_failover_total',
  help: 'Total number of Soroban RPC endpoint failover events',
  labelNames: ['from_endpoint', 'to_endpoint']
});

const rpcRetryCount = new client.Counter({
  name: 'soroban_rpc_retry_total',
  help: 'Total number of Soroban RPC retry attempts',
  labelNames: ['endpoint', 'method']
});

// Circuit Breaker Metrics (per downstream dependency)
const circuitBreakerState = new client.Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state per service (1=active for the labelled state, else 0)',
  labelNames: ['service', 'state']
});

const circuitBreakerTripsTotal = new client.Counter({
  name: 'circuit_breaker_trips_total',
  help: 'Total number of times a circuit breaker has transitioned to OPEN',
  labelNames: ['service']
});

const circuitBreakerFailureCount = new client.Gauge({
  name: 'circuit_breaker_failure_count',
  help: 'Current consecutive failure count tracked by the circuit breaker',
  labelNames: ['service']
});

const circuitBreakerLastStateChange = new client.Gauge({
  name: 'circuit_breaker_last_state_change',
  help: 'Unix timestamp (seconds) of the last circuit breaker state change',
  labelNames: ['service']
});

// Cache-Aside Metrics (Issue #13)
const cacheOperationsTotal = new client.Counter({
  name: 'cache_operations_total',
  help: 'Total number of cache operations by operation, result (hit/miss/invalidate/warm), and key prefix',
  labelNames: ['operation', 'result', 'key_prefix']
});

const cacheOperationDuration = new client.Histogram({
  name: 'cache_operation_duration_seconds',
  help: 'Duration of cache operations in seconds by operation and key prefix',
  labelNames: ['operation', 'key_prefix'],
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5]
});

register.registerMetric(apiResponseTime);
register.registerMetric(activeDbConnections);
register.registerMetric(totalIndexedBlocks);
register.registerMetric(dbPoolIdleConnections);
register.registerMetric(dbPoolWaitingRequests);
register.registerMetric(dbPoolUtilization);
register.registerMetric(dbPoolMaxConnections);
register.registerMetric(dbSlowQueriesTotal);
register.registerMetric(rpcEndpointHealth);
register.registerMetric(rpcHealthCheckLatency);
register.registerMetric(rpcFailoverCount);
register.registerMetric(rpcRetryCount);
register.registerMetric(circuitBreakerState);
register.registerMetric(circuitBreakerTripsTotal);
register.registerMetric(circuitBreakerFailureCount);
register.registerMetric(circuitBreakerLastStateChange);
register.registerMetric(cacheOperationsTotal);
register.registerMetric(cacheOperationDuration);

module.exports = {
  register,
  apiResponseTime,
  activeDbConnections,
  totalIndexedBlocks,
  dbPoolIdleConnections,
  dbPoolWaitingRequests,
  dbPoolUtilization,
  dbPoolMaxConnections,
  dbSlowQueriesTotal,
  rpcEndpointHealth,
  rpcHealthCheckLatency,
  rpcFailoverCount,
  rpcRetryCount,
  circuitBreakerState,
  circuitBreakerTripsTotal,
  circuitBreakerFailureCount,
  circuitBreakerLastStateChange,
  cacheOperationsTotal,
  cacheOperationDuration
};
