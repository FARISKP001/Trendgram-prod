const { sanitizeMessage, validateText } = require('../utils/textFilters');
const { registerUserSocket, unregisterUserSocket, getSocketByUserId } = require('./state');

const WORKER_HTTP_BASE = process.env.CHAT_WORKER_BASE_URL || process.env.WORKER_HTTP_BASE;
const WORKER_WS_BASE = process.env.CHAT_WORKER_WS_BASE || process.env.WORKER_WS_BASE || (WORKER_HTTP_BASE ? WORKER_HTTP_BASE.replace(/^https:/, 'wss:') : null);

const MATCH_ENDPOINT = WORKER_HTTP_BASE ? new URL('/match', WORKER_HTTP_BASE).toString() : null;
const REPORT_ENDPOINT = WORKER_HTTP_BASE ? new URL('/report', WORKER_HTTP_BASE).toString() : null;

const DEFAULT_MODE = 'emoji';

const profileStore = new Map();
const retryTimers = new Map();

function ensureProfile(userId) {
  if (!profileStore.has(userId)) {
    profileStore.set(userId, {
      name: 'Guest',
      deviceId: null,
      lastMode: DEFAULT_MODE,
      lastKey: 'default',
      waitingSince: null,
    });
  }
  return profileStore.get(userId);
}

function clearRetry(userId) {
  const timer = retryTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    retryTimers.delete(userId);
  }
}

function scheduleRetry(io, socket, userId) {
  clearRetry(userId);
  const profile = ensureProfile(userId);
  const timer = setTimeout(() => {
    retryTimers.delete(userId);
    if (!profileStore.has(userId)) return;
    attemptMatch(io, socket, {
      userId,
      mode: profile.lastMode,
      key: profile.lastKey,
    });
  }, 1500);
  retryTimers.set(userId, timer);
}

async function requestJson(url, payload) {
  if (!url) throw new Error('Worker endpoint is not configured');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed with status ${res.status}`);
  }
  return data;
}

async function attemptMatch(io, socket, { userId, mode, key }) {
  try {
    const response = await requestJson(MATCH_ENDPOINT, { userId, mode, key });

    if (response.status === 'matched') {
      clearRetry(userId);
      socket.emit('partner_found', {
        roomId: response.roomId,
        partnerId: response.partnerId,
        wsUrl: response.wsUrl,
        workerWsBase: WORKER_WS_BASE,
      });

      const partnerSocket = getSocketByUserId(io, response.partnerId);
      if (partnerSocket) {
        partnerSocket.emit('match_ready', {
          roomId: response.roomId,
          partnerId: userId,
          wsUrl: response.wsUrl,
          workerWsBase: WORKER_WS_BASE,
        });
      }
    } else {
      const profile = ensureProfile(userId);
      profile.waitingSince = Date.now();
      socket.emit('match_waiting', {
        message: response.message || 'Waiting for a partner...',
      });
      scheduleRetry(io, socket, userId);
    }
  } catch (err) {
    console.error('[match] error', err);
    socket.emit('match_error', { message: err.message || 'Matchmaking failed' });
    scheduleRetry(io, socket, userId);
  }
}

// Persistence removed: friend/message persistence disabled

async function submitReport(payload) {
  if (!REPORT_ENDPOINT) return false;
  try {
    await requestJson(REPORT_ENDPOINT, payload);
    return true;
  } catch (err) {
    console.error('[socket] report submission failed', err);
    return false;
  }
}

module.exports = (io, socket) => {
  const { userId } = socket.handshake.auth || {};
  if (userId) {
    registerUserSocket(userId, socket);
  }

  socket.on('register_user', ({ userId: id, deviceId, userName }) => {
    if (!id) return;
    const cleanName = validateText(userName || '').valid ? sanitizeMessage(userName) : 'Guest';
    const profile = ensureProfile(id);
    profile.name = cleanName;
    profile.deviceId = deviceId || profile.deviceId;
    registerUserSocket(id, socket);
  });

  socket.on('select_mood', ({ userId: id, mood }) => {
    if (!id || !mood) return;
    const profile = ensureProfile(id);
    profile.lastMode = 'emoji';
    profile.lastKey = mood;
    registerUserSocket(id, socket);
    socket.emit('mood_selected', { mood });
    attemptMatch(io, socket, { userId: id, mode: profile.lastMode, key: profile.lastKey });
  });

  socket.on('find_new_buddy', ({ userId: id, userName, deviceId, emotion, language, mode }) => {
    if (!id) return;
    const cleanName = validateText(userName || '').valid ? sanitizeMessage(userName) : 'Guest';
    const profile = ensureProfile(id);
    profile.name = cleanName;
    profile.deviceId = deviceId || profile.deviceId;
    profile.lastMode = mode || DEFAULT_MODE;
    profile.lastKey = emotion || language || profile.lastKey || 'default';
    registerUserSocket(id, socket);
    attemptMatch(io, socket, { userId: id, mode: profile.lastMode, key: profile.lastKey });
  });

  socket.on('next', ({ userId: id }) => {
    if (!id) return;
    const profile = ensureProfile(id);
    attemptMatch(io, socket, { userId: id, mode: profile.lastMode, key: profile.lastKey });
  });

  socket.on('leave_chat', ({ userId: id }) => {
    if (!id) return;
    clearRetry(id);
    socket.emit('left_chat', { message: 'You left the chat. Tap Next to find a new partner.' });
  });

  socket.on('heartbeat', ({ userId: id }) => {
    if (!id) return;
    registerUserSocket(id, socket);
  });

  socket.on('chatMessage', async ({ userId: id, partnerId, message }) => {
    // No-op: persistence removed
    if (!id || !partnerId || !message) return;
    if (!validateText(message || '').valid) return;
  });

  socket.on('report_user', async ({ reporterId, reportedUserId, reason, roomId }) => {
    if (!reporterId || !reportedUserId || !roomId) return;
    const ok = await submitReport({
      reportedId: reportedUserId,
      reason: reason || 'unspecified',
      roomId,
      reporterId,
    });
    socket.emit('report_received', ok
      ? { status: 'accepted', message: 'Thanks. Your report has been submitted.' }
      : { status: 'error', message: 'Failed to submit report. Please try again later.' });
  });

  // Friend request features removed

  // Friend accept feature removed

  // Friend reject feature removed

  socket.on('disconnect', () => {
    if (userId) {
      unregisterUserSocket(userId);
      clearRetry(userId);
    }
  });
};


