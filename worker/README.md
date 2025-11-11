# Cloudflare Worker + Durable Objects Chat Migration

This directory contains the Cloudflare Worker implementation for the Trendgram chat application, migrating from Redis Upstash + EC2 to a serverless architecture.

## Architecture

- **Worker Entrypoint** (`src/index.js`): Handles matchmaking API, routes WebSocket upgrades, applies CORS
- **MatchQueue Durable Object** (`src/match-queue.js`): Performs matchmaking (waiting list, pairing, snapshots)
- **ChatRoom Durable Object** (`src/chat-room.js`): Manages WebSocket connections, broadcasts, heartbeats, teardown
- **KV Namespace (optional)** (`MATCH_QUEUE_BACKUP`): Stores periodic queue snapshots and terminal chat summaries

## Queue keys

- Format: `queue:<category>:<value>`
  - `queue:emotion:😊`
  - `queue:language:english` (lowercased)
  - `queue:mode:emoji`

Derivation happens automatically from the matchmaking payload (`emotion`, `language`, `mode`) when `queueKey` is not passed.

## Setup

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 2. Configure KV Namespace

```bash
# Optional: backup snapshots & terminal chat summaries
wrangler kv:namespace create "MATCH_QUEUE_BACKUP"
wrangler kv:namespace create "MATCH_QUEUE_BACKUP" --preview
```

Update `wrangler.toml` with the returned namespace IDs.

### 3. Login to Cloudflare

```bash
wrangler login
```

## Development

### Local Development

```bash
npm run dev
# or
wrangler dev
```

The worker will be available at `http://localhost:8787`

### Tail Logs

```bash
npm run tail
# or
wrangler tail
```

## Deployment

### Deploy to Cloudflare

```bash
npm run deploy
# or
wrangler deploy
```

### Environment Variables

Set these in Cloudflare Dashboard or via wrangler:

- `ALLOWED_ORIGINS`: Comma-separated list or `*` (default). Used by CORS helper.
- `MATCH_QUEUE_TTL`: Optional matchmaking wait TTL in seconds (default 30s).
- `CHAT_IDLE_MINUTES`: Optional chat idle timeout (default 5 minutes).
- `NODE_ENV`: Optional, for logging behavior.

For local development, you can create a `.dev.vars` file:

```
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
MATCH_QUEUE_TTL=30
CHAT_IDLE_MINUTES=5
```

## API Endpoints

### POST `/api/match`

Matchmaking endpoint. Request body:

```json
{
  "userId": "user-uuid",
  "userName": "User Name",
  "deviceId": "device-fingerprint",
  "emotion": "😊", // optional
  "language": "English", // optional
  "mode": "emoji" // optional
}
```

Response (matched):
```json
{
  "success": true,
  "matched": true,
  "sessionId": "chat:user1:user2",
  "partnerId": "partner-uuid",
  "partnerName": "Partner Name",
  "wsUrl": "wss://worker-url/chat?sessionId=..."
}
```

Response (waiting):
```json
{
  "success": true,
  "matched": false,
  "message": "Waiting for partner...",
  "queueKey": "queue:emotion:😊"
}
```

### GET `/chat?sessionId=...&userId=...&userName=...`

WebSocket endpoint for chat room connection.

## Features

- ✅ Matchmaking using Durable Objects (with optional KV snapshots)
- ✅ WebSocket support via Durable Objects
- ✅ Auto-cleanup after 5 minutes of inactivity
- ✅ Message history (last 20 messages per room)
- ✅ Low latency (<50ms within India edge)
- ✅ Auto-scaling (no EC2 management)

## Performance

- Handles 10,000+ concurrent chats
- Message delivery <50ms (India edge)
- Auto-cleanup prevents resource leaks
- KV TTL prevents queue buildup

## Monitoring

- Use `wrangler tail` for real-time logs
- Cloudflare Dashboard for metrics
- Logs include timestamps for all events

## Migration Checklist

- [x] Worker project structure
- [x] Durable Object class
- [x] Matchmaking logic
- [x] WebSocket handling
- [x] Auto-cleanup alarms
- [x] Frontend WebSocket integration (client connects to `/chat` URL)
- [x] Testing with production load (k6 script)
- [x] Monitoring setup (Analytics Engine + Cloudflare Analytics)
- [x] Gradual cutover toggles (`USE_WORKER_*`) and rollback docs
- [x] Full switchover procedure (Week 4)

## Notes

- Messages are stored in-memory (Durable Object) with ~5min idle TTL
- Each chat room is a separate Durable Object instance
- WebSocket connections are automatically reconnected on failure

## Week 4 Switchover

See `docs/week4-switchover.md` for path-level cutover, flags, and rollback steps.

