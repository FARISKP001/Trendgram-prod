const JSON_HEADERS = { 'content-type': 'application/json' };
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { ...JSON_HEADERS, ...CORS_HEADERS, ...(init.headers || {}) },
  });
}

function appendUserId(wsUrl, userId) {
  if (!wsUrl || !userId) return wsUrl;
  try {
    const composed = new URL(wsUrl);
    composed.searchParams.set('userId', userId);
    return composed.toString();
  } catch (_err) {
    return wsUrl;
  }
}

function buildWsUrl(env, roomId) {
  const httpBase = env.PUBLIC_HTTP_BASE;
  const wsBase = env.PUBLIC_WS_BASE || (httpBase ? httpBase.replace(/^https:/, 'wss:') : null);
  if (!wsBase) {
    throw new Error('PUBLIC_WS_BASE env var is required to construct WebSocket URL');
  }

  const baseUrl = new URL(wsBase);
  const sanitizedPath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname.slice(0, -1) : baseUrl.pathname;
  baseUrl.pathname = `${sanitizedPath}/chat/${roomId}`;
  baseUrl.search = '';
  return baseUrl.toString();
}

async function parseJsonSafe(request) {
  try {
    return await request.json();
  } catch (_err) {
    return null;
  }
}

async function handleMatchRequest(env, payload, options = {}) {
  const { userId, mode, key } = payload || {};
  if (!userId || !mode || !key) {
    return {
      ok: false,
      status: 400,
      body: { error: 'userId, mode, and key are required' },
    };
  }

  const ttlSeconds = options.ttlSeconds ?? 30;
  let matchmakerResponse;
  try {
    const id = env.MATCHMAKER.idFromName(`${mode}:${key}`);
    const stub = env.MATCHMAKER.get(id);
    matchmakerResponse = await stub.fetch('https://match/match', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ userId, mode, key, ttlSeconds }),
    });
  } catch (err) {
    return {
      ok: false,
      status: 502,
      body: { error: 'Failed to contact matchmaker', details: err.message },
    };
  }

  let matchmakerBody = null;
  try {
    matchmakerBody = await matchmakerResponse.json();
  } catch (_err) {
    // ignore; handled below
  }

  if (!matchmakerResponse.ok || !matchmakerBody) {
    return {
      ok: false,
      status: matchmakerResponse.status || 502,
      body: matchmakerBody || { error: 'Matchmaker returned invalid response' },
    };
  }

  if (matchmakerBody.status === 'matched') {
    const partnerId = matchmakerBody.partnerId;
    if (!partnerId) {
      return {
        ok: false,
        status: 502,
        body: { error: 'Matchmaker response missing partnerId' },
      };
    }

    const roomId = `chat_${crypto.randomUUID()}`;
    let wsUrl;
    try {
      wsUrl = buildWsUrl(env, roomId);
    } catch (err) {
      return {
        ok: false,
        status: 500,
        body: { error: 'Worker WebSocket base not configured', details: err.message },
      };
    }

    const stub = env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(roomId));
    const initPayload = {
      roomId,
      mode,
      key,
      users: [partnerId, userId],
      createdAt: Date.now(),
    };

    try {
      await stub.fetch('https://do/init', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(initPayload),
      });
    } catch (err) {
      return {
        ok: false,
        status: 502,
        body: { error: 'Failed to initialize chat room', details: err.message },
      };
    }

    return {
      ok: true,
      status: 200,
      body: {
        status: 'matched',
        roomId,
        partnerId,
        wsUrl,
      },
    };
  }

  if (matchmakerBody.status === 'waiting') {
    return {
      ok: true,
      status: 200,
      body: {
        status: 'waiting',
        message: matchmakerBody.message || 'Waiting for a partner...',
      },
    };
  }

  return {
    ok: false,
    status: 502,
    body: { error: 'Unexpected response from matchmaker' },
  };
}

async function handleReportRequest(env, payload) {
  const { reportedId, reason, roomId, reporterId } = payload || {};
  if (!reportedId || !reason || !roomId) {
    return {
      ok: false,
      status: 400,
      body: { error: 'reportedId, reason, and roomId are required' },
    };
  }

  const reportDoc = {
    reportedId,
    reason,
    roomId,
    reporterId: reporterId || null,
    timestamp: Date.now(),
  };

  if (env.REPORT_API_URL) {
    try {
      await fetch(env.REPORT_API_URL, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(reportDoc),
      });
    } catch (err) {
      return {
        ok: false,
        status: 502,
        body: { error: 'Failed to persist report', details: err.message },
      };
    }
  }

  return {
    ok: true,
    status: 200,
    body: { success: true },
  };
}

async function handleHttpMatch(request, env) {
  const payload = await parseJsonSafe(request);
  const result = await handleMatchRequest(env, payload || {});
  if (!result.ok) {
    return jsonResponse(result.body, { status: result.status });
  }

  const body = { ...result.body };
  if (body.status === 'matched') {
    body.wsUrl = appendUserId(body.wsUrl, payload.userId);
  }

  return jsonResponse(body, { status: result.status });
}

async function handleHttpReport(request, env) {
  const payload = await parseJsonSafe(request);
  const result = await handleReportRequest(env, payload || {});
  return jsonResponse(result.body, { status: result.status });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === 'POST' && (url.pathname === '/match' || url.pathname === '/api/match')) {
      return handleHttpMatch(request, env, ctx);
    }

    if (request.method === 'POST' && (url.pathname === '/report' || url.pathname === '/api/report')) {
      return handleHttpReport(request, env, ctx);
    }

    if (url.pathname.startsWith('/chat/')) {
      const roomId = url.pathname.split('/')[2];
      if (!roomId) {
        return new Response('Missing roomId', { status: 400 });
      }
      const id = env.CHAT_ROOMS.idFromName(roomId);
      const stub = env.CHAT_ROOMS.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  },
};

function safeSend(ws, payload) {
  try {
    ws.send(JSON.stringify(payload));
  } catch (_err) {
    // Ignore send errors; socket may already be closed.
  }
}

export class Matchmaker {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.waiting = null;
    this.defaultTtlMs = 30_000;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/match') {
      const payload = await parseJsonSafe(request);
      return this.handleMatch(payload);
    }

    return new Response('Not found', { status: 404 });
  }

  async handleMatch(payload) {
    const { userId, mode, key, ttlSeconds } = payload || {};
    if (!userId || !mode || !key) {
      return jsonResponse({ error: 'userId, mode, and key are required' }, { status: 400 });
    }

    const effectiveTtlSeconds = typeof ttlSeconds === 'number' && ttlSeconds > 0 ? ttlSeconds : this.defaultTtlMs / 1000;
    const ttlMs = Math.floor(effectiveTtlSeconds * 1000);
    const now = Date.now();

    const waiting = await this.getActiveWaiting(now);

    if (waiting && waiting.userId && waiting.userId !== userId) {
      const partnerId = waiting.userId;
      await this.clearWaiting();
      return jsonResponse({ status: 'matched', partnerId }, { status: 200 });
    }

    const record = {
      userId,
      mode,
      key,
      createdAt: now,
      expiresAt: now + ttlMs,
    };

    await this.saveWaiting(record);

    return jsonResponse(
      {
        status: 'waiting',
        message: 'Waiting for a partner...',
      },
      { status: 200 },
    );
  }

  async getActiveWaiting(nowTs = Date.now()) {
    const waiting = await this.loadWaiting();
    if (!waiting) return null;
    if (waiting.expiresAt && waiting.expiresAt <= nowTs) {
      await this.clearWaiting();
      return null;
    }
    return waiting;
  }

  async loadWaiting() {
    if (!this.waiting) {
      this.waiting = await this.state.storage.get('waiting');
    }
    return this.waiting;
  }

  async saveWaiting(record) {
    this.waiting = record;
    await this.state.storage.put('waiting', record);
    if (record.expiresAt) {
      await this.state.storage.setAlarm(record.expiresAt);
    }
  }

  async clearWaiting() {
    this.waiting = null;
    await this.state.storage.delete('waiting');
  }

  async alarm() {
    const waiting = await this.loadWaiting();
    if (!waiting) return;
    if (waiting.expiresAt && waiting.expiresAt <= Date.now()) {
      await this.clearWaiting();
    }
  }
}

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Map(); // userId -> WebSocket
    this.roomConfig = null;
    this.nextInFlight = false;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/init') {
      const initPayload = await parseJsonSafe(request);
      if (!initPayload || !Array.isArray(initPayload.users)) {
        return new Response('Invalid init payload', { status: 400 });
      }
      this.roomConfig = initPayload;
      await this.state.storage.put('config', initPayload);
      return new Response(null, { status: 204 });
    }

    if (request.method === 'POST' && url.pathname === '/bootstrap') {
      return new Response(null, { status: 204 });
    }

    if (request.headers.get('upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const userId = url.searchParams.get('userId');
    if (!userId) {
      return new Response('Missing userId query parameter', { status: 400 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.handleConnection(server, userId);
    return new Response(null, { status: 101, webSocket: client });
  }

  async loadConfig() {
    if (!this.roomConfig) {
      this.roomConfig = await this.state.storage.get('config');
    }
    return this.roomConfig;
  }

  handleConnection(ws, userId) {
    ws.accept();

    this.loadConfig().then((config) => {
      if (!config || !config.users || !config.users.includes(userId)) {
        safeSend(ws, {
          type: 'system',
          text: 'Chat session no longer available. Please rejoin the queue.',
        });
        ws.close(4404, 'User not part of this room');
        return;
      }

      this.attachSocket(ws, userId);
    });
  }

  attachSocket(ws, userId) {
    this.clients.set(userId, ws);

    safeSend(ws, {
      type: 'system',
      text: 'You are connected. Say hi!',
    });

    const partnerId = this.getPartnerId(userId);
    if (partnerId && this.clients.has(partnerId)) {
      const partnerSocket = this.clients.get(partnerId);
      // Notify existing partner
      safeSend(partnerSocket, {
        type: 'partner_connected',
        userId,
        userName: null,
      });
      // Notify the newly connected user about the partner
      safeSend(ws, {
        type: 'partner_connected',
        userId: partnerId,
        userName: null,
      });
      // Also send a simple system info for compatibility
      safeSend(partnerSocket, {
        type: 'system',
        text: 'Your partner is now connected.',
      });
    }

    ws.addEventListener('message', (event) => {
      this.handleMessage(userId, event.data);
    });

    const handleClose = () => {
      this.handleDisconnect(userId);
    };

    ws.addEventListener('close', handleClose);
    ws.addEventListener('error', handleClose);
  }

  getPartnerId(userId) {
    if (!this.roomConfig || !Array.isArray(this.roomConfig.users)) return null;
    return this.roomConfig.users.find((id) => id !== userId) || null;
  }

  handleMessage(userId, rawData) {
    let payload;
    try {
      payload = JSON.parse(rawData);
    } catch (_err) {
      safeSend(this.clients.get(userId), {
        type: 'error',
        message: 'Invalid message payload',
      });
      return;
    }

    switch (payload.type) {
      case 'message':
      case 'chatMessage': {
        if (typeof payload.text !== 'string') {
          safeSend(this.clients.get(userId), {
            type: 'error',
            message: 'Invalid message text',
          });
          return;
        }
        const text = payload.text.trim();
        if (!text || text.length > 2000) return;
        const outgoing = { type: 'chatMessage', from: userId, text };
        this.broadcast(outgoing, userId);
        break;
      }
      case 'next':
        this.handleNext(userId);
        break;
      case 'leave':
        this.handleLeave(userId);
        break;
      case 'report':
        this.handleReportFromSocket(userId, payload);
        break;
      case 'heartbeat':
        // no-op for now; placeholder for future idle detection.
        break;
      default:
        safeSend(this.clients.get(userId), {
          type: 'error',
          message: 'Unknown event type',
        });
        break;
    }
  }

  broadcast(payload, excludeUserId = null) {
    const message = JSON.stringify(payload);
    for (const [uid, socket] of this.clients.entries()) {
      if (excludeUserId && uid === excludeUserId) continue;
      try {
        socket.send(message);
      } catch (_err) {
        // ignore send errors
      }
    }
  }

  async handleNext(userId) {
    if (this.nextInFlight) return;
    this.nextInFlight = true;
    try {
      const partnerId = this.getPartnerId(userId);

      this.notifyNext(userId, partnerId);

      const config = await this.loadConfig();
      if (!config) {
        this.closeRoom();
        return;
      }

      const users = [userId];
      if (partnerId) users.push(partnerId);

      const matchResults = await this.rematchUsers(users, config);

      for (const uid of users) {
        const socket = this.clients.get(uid);
        if (!socket) continue;
        const result = matchResults[uid];
        if (result) {
          safeSend(socket, {
            type: 'match_result',
            ...result,
          });
        }
        try {
          socket.close(1000, 'Rematching');
        } catch (_err) {}
      }

      this.clients.clear();
      await this.scheduleCleanup();
    } finally {
      this.nextInFlight = false;
    }
  }

  notifyNext(userId, partnerId) {
    const initiatorSocket = this.clients.get(userId);
    if (initiatorSocket) {
      safeSend(initiatorSocket, {
        type: 'system',
        text: 'You have left the chat. Matching you with a new partner...',
      });
    }

    if (partnerId) {
      const partnerSocket = this.clients.get(partnerId);
      if (partnerSocket) {
        safeSend(partnerSocket, {
          type: 'system',
          text: 'Your partner clicked Next. Matching you with someone new...',
        });
      }
    }
  }

  async rematchUsers(users, config) {
    const results = {};

    for (const uid of users) {
      const result = await handleMatchRequest(this.env, {
        userId: uid,
        mode: config.mode,
        key: config.key,
      });

      if (result.ok && result.body.status === 'matched') {
        const { roomId, partnerId, wsUrl } = result.body;
        results[uid] = {
          status: 'matched',
          roomId,
          partnerId,
          wsUrl: appendUserId(wsUrl, uid),
        };

        // Ensure partner receives mirrored payload if they were part of the request set.
        if (users.includes(partnerId)) {
          results[partnerId] = {
            status: 'matched',
            roomId,
            partnerId: uid,
            wsUrl: appendUserId(wsUrl, partnerId),
          };
        }
      } else if (result.ok) {
        results[uid] = {
          status: 'waiting',
          message: 'Waiting for a partner...',
        };
      } else {
        results[uid] = {
          status: 'error',
          message: result.body?.error || 'Matchmaking failed',
        };
      }
    }

    return results;
  }

  async handleLeave(userId) {
    const partnerId = this.getPartnerId(userId);

    const socket = this.clients.get(userId);
    if (socket) {
      safeSend(socket, {
        type: 'system',
        text: 'You have left the chat. Close this window or click Next to find someone new.',
      });
      try {
        socket.close(1000, 'User left');
      } catch (_err) {}
      this.clients.delete(userId);
    }

    if (partnerId && this.clients.has(partnerId)) {
      safeSend(this.clients.get(partnerId), {
        type: 'system',
        text: 'Your partner has left the chat. Click Next to meet someone else.',
      });
    }

    await this.scheduleCleanup();
  }

  async handleReportFromSocket(userId, payload) {
    const config = await this.loadConfig();
    const reportBody = {
      reportedId: payload.reportedId || this.getPartnerId(userId),
      reason: payload.reason || 'unspecified',
      roomId: config?.roomId,
      reporterId: userId,
    };

    const result = await handleReportRequest(this.env, reportBody);

    const socket = this.clients.get(userId);
    if (socket) {
      if (result.ok) {
        safeSend(socket, {
          type: 'system',
          text: 'Thank you. Your report has been submitted.',
        });
      } else {
        safeSend(socket, {
          type: 'error',
          message: result.body?.error || 'Failed to submit report',
        });
      }
    }
  }

  handleDisconnect(userId) {
    const socket = this.clients.get(userId);
    if (socket) {
      this.clients.delete(userId);
    }

    const partnerId = this.getPartnerId(userId);
    if (partnerId && this.clients.has(partnerId)) {
      safeSend(this.clients.get(partnerId), {
        type: 'system',
        text: 'Partner disconnected. Click Next to find a new chat.',
      });
    }

    if (this.clients.size === 0) {
      this.scheduleCleanup();
    }
  }

  async closeRoom() {
    for (const socket of this.clients.values()) {
      try {
        socket.close(1001, 'Room closed');
      } catch (_err) {}
    }
    this.clients.clear();
    await this.scheduleCleanup(0);
  }

  async scheduleCleanup(delayMs = 2000) {
    const fireAt = Date.now() + delayMs;
    await this.state.storage.put('cleanupAt', fireAt);
    await this.state.storage.setAlarm(fireAt);
  }

  async alarm() {
    await this.state.storage.deleteAll();
    for (const socket of this.clients.values()) {
      try {
        socket.close(1001, 'Room timeout');
      } catch (_err) {}
    }
    this.clients.clear();
  }
}


