const express = require('express');
const redis = require('redis');
const winston = require('winston');
const cron = require('node-cron');
const { Client } = require('pg');
const { measureReplicationLag } = require('./walLag');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuration
const config = {
  master: {
    host: process.env.POSTGRES_MASTER_HOST || 'postgres-master',
    port: process.env.POSTGRES_MASTER_PORT || 5432,
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'password',
    database: process.env.POSTGRES_DB || 'vesting_vault'
  },
  replicas: (process.env.POSTGRES_REPLICA_HOSTS || 'postgres-replica-1:5432,postgres-replica-2:5432')
    .split(',')
    .map(host => {
      const [hostname, port] = host.trim().split(':');
      return {
        host: hostname,
        port: parseInt(port) || 5432,
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || 'password',
        database: process.env.POSTGRES_DB || 'vesting_vault'
      };
    }),
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: process.env.REDIS_PORT || 6379
  },
  checkInterval: parseInt(process.env.CHECK_INTERVAL) || 30,
  lagThreshold: parseInt(process.env.LAG_THRESHOLD) || 1000
};

// Setup logging
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: '/app/logs/health-monitor.log' }),
    new winston.transports.Console()
  ]
});

// Redis client for caching health status
let redisClient;

async function initializeRedis() {
  try {
    // node-redis v4 requires transport settings under socket; plain
    // {host,port} silently selects localhost and breaks Compose deployments.
    redisClient = redis.createClient({
      socket: { host: config.redis.host, port: Number(config.redis.port) }
    });
    await redisClient.connect();
    logger.info('Connected to Redis');
  } catch (error) {
    // Redis is an optional cache, not the source of database health.
    redisClient = null;
    logger.error('Failed to connect to Redis:', error);
  }
}

// Health check functions
function createPostgresClient(dbConfig) {
  return new Client({
    host: dbConfig.host,
    port: Number(dbConfig.port),
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
    statement_timeout: 5000
  });
}

async function runPostgresQuery(dbConfig, text) {
  const client = createPostgresClient(dbConfig);
  const startedAt = Date.now();

  try {
    await client.connect();
    const result = await client.query(text);
    return { result, responseTime: Date.now() - startedAt };
  } finally {
    await client.end().catch(() => {});
  }
}

async function checkPostgresConnection(dbConfig) {
  try {
    const { responseTime } = await runPostgresQuery(dbConfig, 'SELECT 1;');
    return { healthy: true, error: null, responseTime };
  } catch (error) {
    return { healthy: false, error: error.message, responseTime: null };
  }
}

async function checkReplicaLag(replicaConfig) {
  try {
    const { result } = await runPostgresQuery(
      replicaConfig,
      'SELECT pg_last_wal_replay_lsn() AS replay_lsn;'
    );
    return { lag: result.rows[0]?.replay_lsn || null, error: null };
  } catch (error) {
    return { lag: null, error: error.message };
  }
}

async function getMasterLsn() {
  try {
    const { result } = await runPostgresQuery(
      config.master,
      'SELECT pg_current_wal_lsn() AS current_lsn;'
    );
    return { lsn: result.rows[0]?.current_lsn || null, error: null };
  } catch (error) {
    return { lsn: null, error: error.message };
  }
}

// Main health check function
async function performHealthCheck() {
  const healthStatus = {
    timestamp: new Date().toISOString(),
    master: null,
    replicas: [],
    overall: 'healthy'
  };

  try {
    // Check master
    logger.info('Checking master database health...');
    healthStatus.master = await checkPostgresConnection(config.master);

    // Check replicas
    for (let i = 0; i < config.replicas.length; i++) {
      logger.info(`Checking replica ${i + 1} health...`);
      const replicaHealth = await checkPostgresConnection(config.replicas[i]);
      
      if (replicaHealth.healthy) {
        // Check replica lag
        const replicaLag = await checkReplicaLag(config.replicas[i]);
        const masterLsn = await getMasterLsn();
        
        replicaHealth.lagThreshold = config.lagThreshold;
        if (replicaLag.lag && masterLsn.lsn) {
          try {
            const measured = measureReplicationLag(
              masterLsn.lsn, replicaLag.lag, config.lagThreshold
            );
            replicaHealth.lag = measured.lag;
            replicaHealth.lagExceeded = measured.lagExceeded;
            if (measured.error) replicaHealth.lagError = measured.error;
          } catch (error) {
            replicaHealth.lag = null;
            replicaHealth.lagExceeded = true;
            replicaHealth.lagError = error.message;
          }
        } else {
          // An unavailable replica/master WAL position must never be
          // reported as healthy with a silently missing lag measurement.
          replicaHealth.lag = null;
          replicaHealth.lagExceeded = true;
          replicaHealth.lagError =
            replicaLag.error || masterLsn.error || 'Replication WAL position unavailable';
        }
      }
      
      healthStatus.replicas.push({
        index: i,
        host: config.replicas[i].host,
        ...replicaHealth
      });
    }

    // Determine overall health
    if (!healthStatus.master.healthy) {
      healthStatus.overall = 'unhealthy';
    } else {
      const unhealthyReplicas = healthStatus.replicas.filter(r => !r.healthy || r.lagExceeded);
      if (unhealthyReplicas.length > 0) {
        healthStatus.overall = 'degraded';
      }
    }

    // Cache results in Redis
    if (redisClient?.isReady) {
      try {
        await redisClient.setEx('db_health_status', 60, JSON.stringify(healthStatus));
      } catch (error) {
        logger.warn('Health-status cache write failed; database probe remains authoritative', error.message);
      }
    }

    logger.info('Health check completed', { overall: healthStatus.overall });
    return healthStatus;

  } catch (error) {
    logger.error('Health check failed:', error);
    healthStatus.overall = 'error';
    healthStatus.error = error.message;
    return healthStatus;
  }
}

// Express routes
app.get('/health', async (req, res) => {
  try {
    const health = await performHealthCheck();
    const statusCode = health.overall === 'healthy' ? 200 : 
                     health.overall === 'degraded' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({ 
      overall: 'error', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/health/cached', async (req, res) => {
  try {
    if (redisClient?.isReady) {
      try {
        const cached = await redisClient.get('db_health_status');
        if (cached) {
          return res.json(JSON.parse(cached));
        }
      } catch (error) {
        logger.warn('Health cache unavailable; checking live database status', error.message);
      }
    }
    const health = await performHealthCheck();
    res.status(health.overall === 'healthy' || health.overall === 'degraded' ? 200 : 503).json(health);
  } catch (error) {
    res.status(503).json({ 
      overall: 'error', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/metrics', async (req, res) => {
  try {
    const health = await performHealthCheck();
    
    // Prometheus-style metrics
    const metrics = [
      `# HELP database_master_up Whether the master database is up`,
      `# TYPE database_master_up gauge`,
      `database_master_up ${health.master?.healthy ? 1 : 0}`,
      ``,
      `# HELP database_replica_up Whether each replica database is up`,
      `# TYPE database_replica_up gauge`,
      ...health.replicas.map((r, i) => `database_replica_up{replica="${r.host}"} ${r.healthy ? 1 : 0}`),
      ``,
      `# HELP database_replica_lag_bytes Replica lag in bytes`,
      `# TYPE database_replica_lag_bytes gauge`,
      ...health.replicas.map((r, i) => `database_replica_lag_bytes{replica="${r.host}"} ${r.lag || 0}`),
      ``,
      `# HELP database_overall_health Overall database cluster health (1=healthy, 0.5=degraded, 0=unhealthy)`,
      `# TYPE database_overall_health gauge`,
      `database_overall_health ${health.overall === 'healthy' ? 1 : health.overall === 'degraded' ? 0.5 : 0}`
    ];

    res.set('Content-Type', 'text/plain');
    res.send(metrics.join('\n'));
  } catch (error) {
    res.status(500).send('Error generating metrics');
  }
});

// Scheduled health checks
cron.schedule(`*/${config.checkInterval} * * * * *`, async () => {
  logger.info('Running scheduled health check...');
  await performHealthCheck();
});

// Initialize and start server
async function start() {
  await initializeRedis();
  
  app.listen(PORT, () => {
    logger.info(`Database health monitor started on port ${PORT}`);
  });

  // Run initial health check
  setTimeout(performHealthCheck, 5000);
}

start().catch(error => {
  logger.error('Failed to start health monitor:', error);
  process.exit(1);
});
