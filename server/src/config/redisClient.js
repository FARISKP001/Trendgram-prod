const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL, {
  tls: {},
  retryStrategy(times) {
    const delay = Math.min(times * 100, 2000);
    console.warn(`\u23F3 Redis reconnect in ${delay}ms`);
    return delay;
  },
  reconnectOnError(err) {
    console.error('\ud83d\udd01 Redis reconnect on error:', err);
    return true;
  },
});

redis.on('connect', () => console.log('\u2705 Redis connected'));
redis.on('error', (err) => console.error('\u274c Redis error:', err));

module.exports = redis;