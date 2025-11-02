const Redis = require('ioredis');

console.log('REDIS_URL:', process.env.REDIS_URL);

const redisConfig = {
  retryStrategy(times) {
    const delay = Math.min(times * 100, 2000);
    console.warn(`\u23F3 Redis reconnect in ${delay}ms`);
    return delay;
  },
  reconnectOnError(err) {
    console.error('\ud83d\udd01 Redis reconnect on error:', err);
    return true;
  },
};

// Only add TLS if REDIS_URL is set (for cloud Redis like Upstash)
if (process.env.REDIS_URL) {
  redisConfig.tls = {};
}

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', redisConfig);

redis.on('connect', () => console.log('\u2705 Redis connected'));
redis.on('error', (err) => console.error('\u274c Redis error:', err));

module.exports = redis;