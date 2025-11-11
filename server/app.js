require('dotenv').config({ path: './.env' });
const express = require('express');
const { createServer } = require('http');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');

const { corsOptions } = require('./src/config/corsOptions');

const emotionStore = new Map();

// MongoDB and Socket.IO removed. All chat and data writes are handled by Cloudflare Worker.

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

// Create HTTP server (Socket.IO removed; Worker handles WebSockets)
const server = createServer(app);

// Emotion result endpoint from n8n
app.post('/emotion-result', async (req, res) => {
  const { userId, emotion } = req.body;
  if (!userId || !emotion) {
    return res.status(400).json({ error: 'userId and emotion required' });
  }

  try {
    emotionStore.set(userId, {
      emotion,
      storedAt: Date.now(),
      expiresAt: Date.now() + 24 * 3600 * 1000,
    });

    // Socket emission removed; Worker WebSockets handle realtime updates

    res.json({ success: true });
  } catch (error) {
    console.error('Emotion result error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Simple health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Socket.IO removed: matchmaking and chat handled by Cloudflare Worker

// Start server
const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
