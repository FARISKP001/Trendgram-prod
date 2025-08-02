require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const Redis = require('ioredis');
const cors = require('cors'); // ✅ Added

const registerSocketHandlers = require('./src/socket');

// Create Express app
const app = express();

// ✅ CORS configuration (allow Cloudflare Pages + local dev)
const allowedOrigins = [
  'https://trendgram.pages.dev',
  'http://localhost:5173'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
}));

// JSON body parser
app.use(express.json());

// Create HTTP server and attach Socket.IO
const server = createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 15000,
  cors: {
  origin: [
    'https://trendgram.pages.dev',
    'http://localhost:5173'
  ],
  methods: ['GET', 'POST'],
  credentials: true
}

});

// Redis setup
const redis = new Redis(process.env.REDIS_URL, {
  tls: {},
  retryStrategy(times) {
    const delay = Math.min(times * 100, 2000);
    console.warn(`⏳ Redis reconnect in ${delay}ms`);
    return delay;
  },
  reconnectOnError(err) {
    console.error('🔁 Redis reconnect on error:', err);
    return true;
  },
});

// Redis connection logs
redis.on('connect', () => console.log('✅ Redis connected'));
redis.on('error', (err) => console.error('❌ Redis error:', err));

// Register socket.io handlers
registerSocketHandlers(io, redis);

// ✅ CAPTCHA verification route
app.post('/api/verify-captcha', async (req, res) => {
  const { token, deviceId } = req.body || {};
  if (!token || !deviceId) return res.status(400).json({ success: false });

  try {
    const secret = process.env.CF_SECRET;
    const params = new URLSearchParams();
    params.append('secret', secret);
    params.append('response', token);

    const cfRes = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        body: params,
      }
    );
    const data = await cfRes.json();
    if (data.success) {
      await redis.set(`captcha:passed:${deviceId}`, 1, 'EX', 3600); // 1-hour validity
    }
    res.json({ success: !!data.success });
  } catch (err) {
    console.error('Captcha verification failed', err);
    res.status(500).json({ success: false });
  }
});

// ✅ Start server
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://${HOST}:${PORT}`);
});
