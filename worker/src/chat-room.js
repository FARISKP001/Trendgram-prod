/**
 * ChatRoomDO is responsible for managing a single chat session between two users.
 * It keeps transient state in-memory, persists lightweight snapshots to state.storage,
 * and writes a final summary to KV before tearing itself down when both users leave.
 */
export class ChatRoomDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.roomId = state.id.toString();
    this.clients = new Map(); // userId -> WebSocket
    this.userNames = new Map(); // userId -> userName
    this.messages = [];
    this.stats = { totalMessages: 0 };
    this.disconnectedUsers = new Set();
    this.config = null;
    this.queueKey = null;
    this.sessionId = null;
    this.snapshotKey = `chat:snapshot:${this.roomId}`;

    this.state.blockConcurrencyWhile(async () => {
      this.config = await this.state.storage.get("config");
      this.queueKey = await this.state.storage.get("queueKey");
      this.sessionId = await this.state.storage.get("sessionId");
      // Fallback: try to get from state.id.name if it's a named ID
      if (!this.sessionId && this.state.id.name) {
        this.sessionId = this.state.id.name;
      }
      const storedMessages = await this.state.storage.get("messages");
      if (storedMessages) this.messages = storedMessages;
      const storedStats = await this.state.storage.get("stats");
      if (storedStats) this.stats = storedStats;
    });
  }

  getIdleTimeoutMs() {
    // Default: 5 minutes
    const raw = this.env?.CHAT_IDLE_MINUTES;
    const minutes = Number.parseInt(raw, 10);
    if (Number.isFinite(minutes) && minutes > 0 && minutes <= 60) {
      return minutes * 60_000;
    }
    return 5 * 60_000;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "POST" && url.pathname.endsWith("/init")) {
      return this.handleInit(request);
    }

    if (method === "POST" && url.pathname.endsWith("/leave")) {
      return this.handleLeave(request);
    }

    if (request.headers.get("upgrade") === "websocket") {
      return this.handleWebSocket(request);
    }

    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  async handleInit(request) {
    const payload = await request.json();
    if (!payload?.users || !Array.isArray(payload.users)) {
      return new Response("Invalid init payload", { status: 400 });
    }

    console.log(`[ChatRoomDO:${this.roomId}] handleInit`, {
      queueKey: payload.queueKey,
      userIds: payload.users.map((u) => (typeof u === "string" ? u : u.userId)),
    });

    this.queueKey = payload.queueKey ?? this.queueKey ?? null;
    // Extract sessionId from payload if available, or use state.id.name
    if (payload.sessionId) {
      this.sessionId = payload.sessionId;
    } else if (!this.sessionId && this.state.id.name) {
      this.sessionId = this.state.id.name;
    }
    
    this.config = {
      roomId: this.roomId,
      sessionId: this.sessionId,
      queueKey: payload.queueKey ?? null,
      filters: payload.filters ?? {},
      users: payload.users,
      createdAt: payload.createdAt ?? Date.now(),
    };

    await this.state.storage.put("config", this.config);
    await this.state.storage.put("messages", this.messages);
    await this.state.storage.put("stats", this.stats);
    await this.state.storage.put("queueKey", this.queueKey);
    if (this.sessionId) {
      await this.state.storage.put("sessionId", this.sessionId);
    }

    // Schedule idle cleanup in case clients never connect
    try {
      await this.state.storage.setAlarm(Date.now() + this.getIdleTimeoutMs());
    } catch (err) {
      console.error(`[ChatRoomDO:${this.roomId}] failed to set idle alarm`, err);
    }

    return new Response(null, { status: 204 });
  }

  async handleLeave(request) {
    const payload = await request.json();
    if (!payload?.userId) {
      return new Response("userId is required", { status: 400 });
    }

    await this.cleanupChat(payload.userId, { reason: "manual_leave" });
    return new Response(null, { status: 204 });
  }

  handleWebSocket(request) {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const userName = url.searchParams.get("userName") || "Stranger";
    const queueKeyParam = url.searchParams.get("queueKey");
    const sessionIdParam = url.searchParams.get("sessionId");

    if (!userId) {
      return new Response("Missing userId query parameter", { status: 400 });
    }

    // Store sessionId if provided (needed for rehydration)
    if (sessionIdParam) {
      this.sessionId = sessionIdParam;
      this.state.storage.put("sessionId", this.sessionId).catch((err) =>
        console.error(`[ChatRoomDO:${this.roomId}] failed to persist sessionId`, err),
      );
    } else {
      // Fallback: try to get from state.id.name if it's a named ID
      const idName = this.state.id.name;
      if (idName) {
        this.sessionId = idName;
      }
    }

    if (queueKeyParam) {
      this.queueKey = queueKeyParam;
      this.state.storage.put("queueKey", this.queueKey).catch((err) =>
        console.error(`[ChatRoomDO:${this.roomId}] failed to persist queueKey from websocket`, err),
      );
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.acceptSocket(server, { userId, userName }).catch((err) =>
      console.error(`[ChatRoomDO:${this.roomId}] accept socket failed`, err),
    );

    // Observability: connection attempt
    try {
      this.env.AE?.writeDataPoint({
        blobs: ["ws_connect", this.queueKey || "unknown"],
        doubles: [1],
      });
    } catch (_err) {}

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: {
        Upgrade: "websocket",
        Connection: "Upgrade",
      },
    });
  }

  async acceptSocket(ws, { userId, userName }) {
    ws.accept();

    try {
      await this.ensureConfig();
    } catch (error) {
      console.error(`[ChatRoomDO:${this.roomId}] failed to load config`, error);
      const restored = await this.rehydrateConfig();
      if (!restored) {
        safeSend(ws, {
          type: "system",
          text: "Chat session is not ready. Returning to matchmaking...",
        });
        try {
          ws.close(1012, "Chat configuration missing");
        } catch (_) {
          /* ignore */
        }
        return;
      }
    }

    this.clients.set(userId, ws);
    this.userNames.set(userId, userName);
    this.disconnectedUsers.delete(userId);

    if (this.messages.length) {
      safeSend(ws, { type: "history", messages: this.messages.slice(-20) });
    }

    const partnerId = this.getPartnerId(userId);
    if (partnerId) {
      const partnerName = this.userNames.get(partnerId) ?? "Stranger";
      console.log(`[ChatRoomDO:${this.roomId}] User ${userId} connected, partnerId: ${partnerId}, partnerName: ${partnerName}, partnerConnected: ${this.clients.has(partnerId)}`);
      
      // If partner is already connected, notify both users
      if (this.clients.has(partnerId)) {
        console.log(`[ChatRoomDO:${this.roomId}] Both users connected, sending partner_connected events`);
        safeSend(ws, {
          type: "partner_connected",
          userId: partnerId,
          userName: partnerName,
          timestamp: Date.now(),
        });
        safeSend(this.clients.get(partnerId), {
          type: "partner_connected",
          userId,
          userName,
          timestamp: Date.now(),
        });
      } else {
        // Partner not connected yet, but send info about who they're waiting for
        // This helps the UI show the correct partner name
        console.log(`[ChatRoomDO:${this.roomId}] Partner not connected yet, sending partner_info`);
        safeSend(ws, {
          type: "partner_info",
          userId: partnerId,
          userName: partnerName,
          timestamp: Date.now(),
        });
      }
    } else {
      console.warn(`[ChatRoomDO:${this.roomId}] No partnerId found for userId: ${userId}`);
    }

    ws.addEventListener("message", (event) => {
      this.handleSocketMessage(userId, event.data);
    });

    ws.addEventListener("close", (event) => {
      this.cleanupChat(userId, {
        reason: "socket_close",
        closeInfo: { code: event.code, reason: event.reason },
      });
      try {
        this.env.AE?.writeDataPoint({
          blobs: ["ws_close", this.queueKey || "unknown"],
          doubles: [1],
        });
      } catch (_err) {}
    });

    ws.addEventListener("error", (error) => {
      console.error(`[ChatRoomDO:${this.roomId}] socket error for ${userId}`, error);
      this.cleanupChat(userId, { reason: "socket_error" });
      try {
        this.env.AE?.writeDataPoint({
          blobs: ["ws_error", this.queueKey || "unknown"],
          doubles: [1],
        });
      } catch (_err) {}
    });
  }

  handleSocketMessage(userId, rawData) {
    let payload;
    try {
      payload = JSON.parse(rawData);
    } catch (error) {
      safeSend(this.clients.get(userId), {
        type: "error",
        message: "Invalid message payload",
      });
      return;
    }

    switch (payload.type) {
      case "chatMessage": {
        const text = typeof payload.message === "string" ? payload.message.trim() : "";
        if (!text) return;
        if (text.length > 2000) return;

        const messageRecord = {
          type: "chatMessage",
          userId,
          userName: this.userNames.get(userId) ?? "Stranger",
          message: text,
          timestamp: Date.now(),
        };

        this.messages.push(messageRecord);
        if (this.messages.length > 100) {
          this.messages.shift();
        }
        this.stats.totalMessages += 1;
        this.persistSnapshotSoon();

        this.broadcast(messageRecord, userId);
      try {
        this.env.AE?.writeDataPoint({
          blobs: ["ws_message", this.queueKey || "unknown"],
          doubles: [1],
        });
      } catch (_err) {}
        break;
      }
      case "next":
        this.cleanupChat(userId, { reason: "user_clicked_next" });
        break;
      case "heartbeat":
        safeSend(this.clients.get(userId), { type: "heartbeat_ack", timestamp: Date.now() });
        break;
      default:
        safeSend(this.clients.get(userId), {
          type: "error",
          message: `Unknown event type: ${payload.type}`,
        });
    }
  }

  broadcast(message, excludeUserId) {
    const encoded = JSON.stringify(message);
    for (const [uid, socket] of this.clients.entries()) {
      if (uid === excludeUserId) continue;
      try {
        socket.send(encoded);
      } catch (error) {
        console.error(`[ChatRoomDO:${this.roomId}] broadcast failure`, error);
      }
    }
  }

  getPartnerId(userId) {
    if (!this.config?.users) return null;
    const ids = this.config.users.map((entry) =>
      typeof entry === "string" ? entry : entry.userId,
    );
    return ids.find((id) => id !== userId) ?? null;
  }

  /**
   * Cleanup wrapper invoked for every disconnect path (socket close, manual leave, browser exit).
   * It removes the user from in-memory collections, notifies the remaining participant, informs
   * the matchmaking layer, and when the room is empty it writes a terminal snapshot before
   * deleting all persisted state so the Durable Object can be evicted.
   */
  async cleanupChat(userId, context = {}) {
    if (!userId || this.disconnectedUsers.has(userId)) return;
    this.disconnectedUsers.add(userId);

    const departingName = this.userNames.get(userId) ?? "Stranger";
    const socket = this.clients.get(userId);
    if (socket) {
      try {
        socket.close(1000, context.reason ?? "disconnect");
      } catch (_) {
        /* ignore */
      }
    }
    this.clients.delete(userId);
    this.userNames.delete(userId);

    await this.notifyMatchQueue(userId);

    const partnerId = this.getPartnerId(userId);
    if (partnerId && this.clients.has(partnerId)) {
      safeSend(this.clients.get(partnerId), {
        type: "partner_disconnected",
        userId,
        userName: departingName,
        reason: context.reason ?? "disconnect",
        timestamp: Date.now(),
      });
    }

    if (this.clients.size === 0) {
      await this.finalizeAndDestroy(context);
    } else {
      await this.persistSnapshotSoon();
    }
  }

  async notifyMatchQueue(userId) {
    if (!this.config?.queueKey || !this.env.MATCH_QUEUE) return;
    try {
      const stub = this.env.MATCH_QUEUE.get(
        this.env.MATCH_QUEUE.idFromName(this.config.queueKey),
      );
      await stub.fetch("https://queue.internal/leave", {
        method: "POST",
        body: JSON.stringify({ userId }),
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error(
        `[ChatRoomDO:${this.roomId}] failed to notify match queue about ${userId}`,
        error,
      );
    }
  }

  async finalizeAndDestroy(context) {
    const finalSnapshot = {
      chatId: this.roomId,
      endedAt: Date.now(),
      reason: context.reason ?? "cleanup",
      userIds: Array.isArray(this.config?.users)
        ? this.config.users.map((entry) => (typeof entry === "string" ? entry : entry.userId)).filter(Boolean)
        : Array.from(this.userNames.keys()),
      totalMessages: this.stats.totalMessages,
    };

    if (this.env.MATCH_QUEUE_BACKUP) {
      try {
        // Persist a terminal snapshot for analytics before removing the ephemeral record.
        await this.env.MATCH_QUEUE_BACKUP.put(
          this.snapshotKey,
          JSON.stringify(finalSnapshot),
        );
        // Removing the key keeps the KV namespace tidy once downstream processors have consumed it.
        await this.env.MATCH_QUEUE_BACKUP.delete(this.snapshotKey);
      } catch (error) {
        console.error(
          `[ChatRoomDO:${this.roomId}] failed to persist/delete final snapshot`,
          error,
        );
      }
    }

    await this.state.storage.deleteAll();
    this.clients.clear();
    this.userNames.clear();
    this.messages = [];
    this.stats = { totalMessages: 0 };
    this.config = null;
    this.queueKey = null;
  }

  async persistSnapshotSoon() {
    await this.state.storage.put("messages", this.messages);
    await this.state.storage.put("stats", this.stats);
  }

  async alarm() {
    // Idle alarm: if nobody is connected, tear down the room to avoid leaks
    if (this.clients.size === 0) {
      await this.finalizeAndDestroy({ reason: "idle_timeout" });
      return;
    }

    // If someone is connected, re-arm the alarm for continued supervision
    try {
      await this.state.storage.setAlarm(Date.now() + this.getIdleTimeoutMs());
    } catch (err) {
      console.error(`[ChatRoomDO:${this.roomId}] failed to re-arm idle alarm`, err);
    }
  }

  async ensureConfig() {
    if (this.config) return this.config;

    if (!this.queueKey) {
      const storedQueueKey = await this.state.storage.get("queueKey");
      if (storedQueueKey) this.queueKey = storedQueueKey;
    }

    const tryLoad = async () => {
      const stored = await this.state.storage.get("config");
      if (stored) {
        this.config = stored;
        // Populate userNames map from config if users are defined
        if (this.config.users && Array.isArray(this.config.users)) {
          for (const user of this.config.users) {
            const uid = typeof user === "string" ? user : user.userId;
            const uname = typeof user === "string" ? "Stranger" : (user.userName || "Stranger");
            if (uid && !this.userNames.has(uid)) {
              this.userNames.set(uid, uname);
            }
          }
        }
        return true;
      }
      return false;
    };

    if (await tryLoad()) return this.config;

    // Poll a few times to allow the /init request to arrive.
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (await tryLoad()) return this.config;
    }

    throw new Error(`Chat configuration missing for ${this.roomId}`);
  }

  async rehydrateConfig() {
    console.log(`[ChatRoomDO:${this.roomId}] attempting to rehydrate config...`);
    
    // Try to load queueKey from storage if not already set
    if (!this.queueKey) {
      this.queueKey = await this.state.storage.get("queueKey");
    }
    
    if (!this.env.MATCH_QUEUE || !this.queueKey) {
      console.warn(`[ChatRoomDO:${this.roomId}] unable to rehydrate config: missing MATCH_QUEUE binding or queueKey (queueKey: ${this.queueKey})`);
      return false;
    }

    // Ensure we have sessionId - try to get from storage or state.id.name
    if (!this.sessionId) {
      this.sessionId = await this.state.storage.get("sessionId");
      if (!this.sessionId && this.state.id.name) {
        this.sessionId = this.state.id.name;
      }
    }

    if (!this.sessionId) {
      console.warn(`[ChatRoomDO:${this.roomId}] unable to rehydrate config: missing sessionId (queueKey: ${this.queueKey})`);
      return false;
    }

    console.log(`[ChatRoomDO:${this.roomId}] calling heal with sessionId: ${this.sessionId}, queueKey: ${this.queueKey}`);

    try {
      const stub = this.env.MATCH_QUEUE.get(
        this.env.MATCH_QUEUE.idFromName(this.queueKey),
      );
      const healResponse = await stub.fetch("https://queue.internal/heal", {
        method: "POST",
        body: JSON.stringify({ sessionId: this.sessionId }),
        headers: { "Content-Type": "application/json" },
      });
      const healResult = await healResponse.json();
      console.log(`[ChatRoomDO:${this.roomId}] heal response:`, healResult);
    } catch (error) {
      console.error(`[ChatRoomDO:${this.roomId}] failed to request heal from queue`, error);
      return false;
    }

    console.log(`[ChatRoomDO:${this.roomId}] polling for config after heal...`);
    // Wait a bit longer initially to allow bootstrap to complete
    await new Promise((resolve) => setTimeout(resolve, 500));
    
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const stored = await this.state.storage.get("config");
      if (stored) {
        console.log(`[ChatRoomDO:${this.roomId}] ✅ Config found after ${attempt + 1} attempts`);
        this.config = stored;
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.error(`[ChatRoomDO:${this.roomId}] rehydrate attempt timed out after 50 attempts`);
    return false;
  }
}

function safeSend(ws, payload) {
  if (!ws) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (_) {
    /* ignore send failures */
  }
}

export { ChatRoomDO as ChatRoom };
