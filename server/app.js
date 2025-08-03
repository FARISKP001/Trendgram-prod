require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const registerSocketHandlers = require('./src/socket');
const redis = require('./src/config/redisClient');
const { corsOptions, socketCorsOptions } = require('./src/config/corsOptions');

// Create Express app
const app = express();

// Apply CORS configuration
app.use(cors(corsOptions));

// Compress responses
app.use(compression());

// Set security-related HTTP headers
app.use(helmet());

// Cache GET responses briefly
app.use((req, res, next) => {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'public, max-age=60');
  }
  next();
});

// JSON body parser
app.use(express.json());

// Rate limit CAPTCHA verification to prevent abuse
const captchaLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/verify-captcha', captchaLimiter);

// Create HTTP server and attach Socket.IO
const server = createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 15000,
  cors: socketCorsOptions,
  perMessageDeflate: { threshold: 1024 },
});

// Register socket.io handlers
registerSocketHandlers(io, redis);

// CAPTCHA verification route
require('./src/routes/captcha')(app, redis);

// Start server
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';