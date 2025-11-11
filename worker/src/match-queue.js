export class MatchQueueDO {
  static PRIMARY_INTERVAL_MS = 15_000;
  static SECONDARY_INTERVAL_MS = 5 * 60_000;

  constructor(state, env) {
    this.state = state;
    this.env = env;

    this.queueId = state.id.toString();
    this.meta = {
      queueId: this.queueId,
      filters: null,
      stats: { joinCount: 0, matchCount: 0 },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.waitingUsers = [];
    this.activeMatches = new Map();
    this.matchByUser = new Map();

    this.nextPrimarySnapshotAt = 0;
    this.nextSecondarySnapshotAt = 0;
    this.isRestored = false;

    this.state.blockConcurrencyWhile(async () => {
      await this.restoreFromStorage();
      if (!this.isRestored) {
        await this.restoreFromKV();
      }
      this.scheduleSnapshots(true);
    });
  }

  getQueueTtlMs() {
    const raw = this.env?.MATCH_QUEUE_TTL;
    const seconds = Number.parseInt(raw, 10);
    if (Number.isFinite(seconds) && seconds > 0 && seconds < 3600) {
      return seconds * 1000;
    }
    return 30_000; // default 30s
  }

  sanitizeInputString(value, { name, max = 256, required = true } = {}) {
    const str = typeof value === "string" ? value : (value == null ? "" : String(value));
    const trimmed = str.trim();
    if (required && !trimmed) {
      throw new Error(`${name || "value"} is required`);
    }
    if (trimmed.length > max) {
      throw new Error(`${name || "value"} exceeds maximum length of ${max}`);
    }
    return trimmed;
  }

  async fetch(request) {
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();

    try {
      if (method === "POST" && pathname.endsWith("/join")) {
        const body = await request.json();
        return this.wrapResult(await this.handleJoin(body));
      }

      if (method === "POST" && pathname.endsWith("/leave")) {
        const body = await request.json();
        return this.wrapResult(await this.handleLeave(body));
      }

      if (method === "GET" && pathname.endsWith("/status")) {
        return this.wrapResult(this.handleStatus());
      }

      if (method === "POST" && pathname.endsWith("/heal")) {
        const body = await request.json();
        return this.wrapResult(await this.handleHeal(body));
      }

      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      console.error(`[MatchQueueDO:${this.queueId}]`, error);
      return new Response(
        JSON.stringify({ error: error.message ?? "Internal error" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  wrapResult(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  async handleJoin(body) {
    const raw = body ?? {};
    const userId = this.sanitizeInputString(raw.userId, { name: "userId", max: 128 });
    const userName = this.sanitizeInputString(raw.userName, { name: "userName", max: 64 });
    const deviceId = this.sanitizeInputString(raw.deviceId, { name: "deviceId", max: 128 });
    const queueKey = this.sanitizeInputString(raw.queueKey, { name: "queueKey", max: 256 });
    const emotion = typeof raw.emotion === "string" ? raw.emotion.slice(0, 32) : null;
    const language = typeof raw.language === "string" ? raw.language.toLowerCase().slice(0, 32) : null;
    const mode = typeof raw.mode === "string" ? raw.mode.slice(0, 32) : null;
    const wsBase = typeof raw.wsBase === "string" ? raw.wsBase : null;
    const wsProtocol = typeof raw.wsProtocol === "string" ? (raw.wsProtocol === "ws" ? "ws" : "wss") : "wss";

    // At this point userId, userName, deviceId, queueKey are validated

    if (!this.meta.filters) {
      this.meta.filters = this.parseQueueKey(queueKey, { emotion, language, mode });
    }

    const timestamp = Date.now();

    // Prune stale waiting users based on TTL
    const ttlMs = this.getQueueTtlMs();
    if (this.waitingUsers.length) {
      this.waitingUsers = this.waitingUsers.filter((u) => !u.joinedAt || (timestamp - u.joinedAt) < ttlMs);
    }

    const existingMatch = this.matchByUser.get(userId);
    if (existingMatch) {
      const matchData = this.activeMatches.get(existingMatch);
      if (matchData) {
        return { matched: true, ...matchData };
      }
    }

    this.removeWaitingUser(userId);

    if (this.waitingUsers.length > 0) {
      const partner = this.waitingUsers.shift();
      const sessionId = this.generateSessionId(userId, partner.userId);
      await this.bootstrapChatRoom(sessionId, {
        queueKey,
        filters: this.meta.filters ?? {},
        users: [
          { userId, userName, deviceId },
          { userId: partner.userId, userName: partner.userName, deviceId: partner.deviceId },
        ],
        createdAt: timestamp,
      });

      const encodedQueueKey = encodeURIComponent(queueKey);
      const wsUrlA = wsBase
        ? `${wsProtocol}://${wsBase}/chat?sessionId=${encodeURIComponent(sessionId)}&userId=${encodeURIComponent(userId)}&queueKey=${encodedQueueKey}`
        : null;
      const wsUrlB = wsBase
        ? `${wsProtocol}://${wsBase}/chat?sessionId=${encodeURIComponent(sessionId)}&userId=${encodeURIComponent(partner.userId)}&queueKey=${encodedQueueKey}`
        : null;

      const matchRecord = {
        sessionId,
        queueId: this.queueId,
        queueKey,
        filters: this.meta.filters ?? {},
        userId,
        userName,
        deviceId,
        partnerId: partner.userId,
        partnerName: partner.userName,
        partnerDeviceId: partner.deviceId,
        createdAt: timestamp,
        wsUrl: wsUrlA,
        partnerWsUrl: wsUrlB,
      };

      this.activeMatches.set(sessionId, matchRecord);
      this.matchByUser.set(userId, sessionId);
      this.matchByUser.set(partner.userId, sessionId);

      this.meta.stats.matchCount += 1;
      this.meta.updatedAt = timestamp;
      this.scheduleSnapshots();
      await this.persistMatchSnapshot();

      // Observability: matched pair
      try {
        this.env.AE?.writeDataPoint({
          blobs: ["matched", queueKey],
          doubles: [1],
        });
      } catch (_err) {}

      return { matched: true, ...matchRecord };
    }

    const userRecord = {
      userId,
      userName,
      deviceId,
      emotion,
      language,
      mode,
      joinedAt: timestamp,
      queueKey,
    };

    this.waitingUsers.push(userRecord);
    this.meta.stats.joinCount += 1;
    this.meta.updatedAt = timestamp;
    this.scheduleSnapshots();

    // Observability: queued
    try {
      this.env.AE?.writeDataPoint({
        blobs: ["queued", queueKey],
        doubles: [1],
      });
    } catch (_err) {}

    return { matched: false, waitingUsers: this.waitingUsers.length };
  }

  async handleLeave(body) {
    const { userId } = body ?? {};
    if (!userId) {
      throw new Error("userId is required");
    }

    return this.onUserLeave(userId);
  }

  handleStatus() {
    return {
      queueId: this.queueId,
      filters: this.meta.filters ?? {},
      waiting: this.waitingUsers.length,
      activeMatches: this.activeMatches.size,
      stats: this.meta.stats,
      updatedAt: this.meta.updatedAt,
    };
  }

  async handleHeal(body) {
    // Restore from storage first (where recent matches are saved immediately)
    await this.restoreFromStorage();
    // Then restore from KV as backup
    await this.restoreFromKV(true);

    const sessionId = body?.sessionId;
    if (!sessionId) {
      return { ok: true, replayed: false };
    }

    const match = this.activeMatches.get(sessionId);
    if (!match) {
      return { ok: true, replayed: false };
    }

    await this.bootstrapChatRoom(sessionId, {
      queueKey: match.queueKey,
      filters: match.filters,
      users: [
        { userId: match.userId, userName: match.userName, deviceId: match.deviceId },
        {
          userId: match.partnerId,
          userName: match.partnerName,
          deviceId: match.partnerDeviceId,
        },
      ],
      createdAt: match.createdAt,
    });

    return { ok: true, replayed: true };
  }

  async persistMatchSnapshot() {
    const payload = this.serializeSnapshot();
    try {
      await this.state.storage.put("queueState", payload);
    } catch (error) {
      console.error(`[MatchQueueDO:${this.queueId}] Failed to persist match snapshot`, error);
    }
  }

  removeWaitingUser(userId) {
    const before = this.waitingUsers.length;
    if (!before) return false;
    this.waitingUsers = this.waitingUsers.filter((user) => user.userId !== userId);
    return this.waitingUsers.length !== before;
  }

  /**
   * Remove a user from the matchmaking system.
   * This is called when the REST endpoint /queue/leave is hit OR when the chat layer observes
   * a disconnect before the match is fully established. Keeping the logic centralised prevents
   * stale references to users in waiting or active match maps.
   */
  onUserLeave(userId) {
    const timestamp = Date.now();
    let removedFromQueue = this.removeWaitingUser(userId);
    const sessionId = this.matchByUser.get(userId);
    let canceledMatch = null;

    if (sessionId) {
      canceledMatch = this.activeMatches.get(sessionId) ?? null;
      if (canceledMatch) {
        this.activeMatches.delete(sessionId);
        this.matchByUser.delete(canceledMatch.userId);
        this.matchByUser.delete(canceledMatch.partnerId);
      } else {
        this.matchByUser.delete(userId);
      }
      removedFromQueue = true;
    }

    if (removedFromQueue || canceledMatch) {
      this.meta.updatedAt = timestamp;
      this.scheduleSnapshots();
    }

    return {
      removedFromQueue,
      matchCanceled: !!canceledMatch,
      canceledMatch,
    };
  }

  scheduleSnapshots(isInitial = false) {
    const now = Date.now();
    if (isInitial || !this.nextPrimarySnapshotAt || now >= this.nextPrimarySnapshotAt) {
      this.nextPrimarySnapshotAt = now + MatchQueueDO.PRIMARY_INTERVAL_MS;
    }
    if (isInitial || !this.nextSecondarySnapshotAt || now >= this.nextSecondarySnapshotAt) {
      this.nextSecondarySnapshotAt = now + MatchQueueDO.SECONDARY_INTERVAL_MS;
    }

    const nextAlarm = Math.min(this.nextPrimarySnapshotAt, this.nextSecondarySnapshotAt);
    this.state.storage.setAlarm(nextAlarm).catch((err) => {
      console.error(`[MatchQueueDO:${this.queueId}] Failed to set alarm`, err);
    });
  }

  async alarm() {
    const now = Date.now();
    if (now >= this.nextPrimarySnapshotAt) {
      await this.savePrimarySnapshot();
      this.nextPrimarySnapshotAt = now + MatchQueueDO.PRIMARY_INTERVAL_MS;
    }

    if (now >= this.nextSecondarySnapshotAt) {
      await this.saveSecondarySnapshot();
      this.nextSecondarySnapshotAt = now + MatchQueueDO.SECONDARY_INTERVAL_MS;
    }

    this.scheduleSnapshots();
  }

  async savePrimarySnapshot() {
    const payload = this.serializeSnapshot();
    try {
      await this.state.storage.put("queueState", payload);
    } catch (error) {
      console.error(`[MatchQueueDO:${this.queueId}] Failed to save primary snapshot`, error);
    }
  }

  async saveSecondarySnapshot() {
    const payload = this.serializeSnapshot();
    try {
      if (this.env.MATCH_QUEUE_BACKUP) {
        await this.env.MATCH_QUEUE_BACKUP.put(`snapshot:${this.queueId}`, JSON.stringify(payload), {
          expirationTtl: 7 * 24 * 60 * 60,
        });
      }
    } catch (error) {
      console.error(`[MatchQueueDO:${this.queueId}] Failed to save secondary snapshot`, error);
    }
  }

  serializeSnapshot() {
    return {
      metadata: this.meta,
      waitingUsers: this.waitingUsers,
      activeMatches: Array.from(this.activeMatches.values()),
      timestamp: Date.now(),
    };
  }

  async restoreFromStorage() {
    try {
      const snapshot = await this.state.storage.get("queueState");
      if (!snapshot) return;
      this.applySnapshot(snapshot, "storage");
    } catch (error) {
      console.error(`[MatchQueueDO:${this.queueId}] Failed to restore from storage`, error);
    }
  }

  async restoreFromKV(force = false) {
    if (!this.env.MATCH_QUEUE_BACKUP) return;
    if (this.isRestored && !force) return;

    try {
      const raw = await this.env.MATCH_QUEUE_BACKUP.get(`snapshot:${this.queueId}`);
      if (!raw) return;
      const snapshot = JSON.parse(raw);
      this.applySnapshot(snapshot, "kv");
    } catch (error) {
      console.error(`[MatchQueueDO:${this.queueId}] Failed to restore from KV`, error);
    }
  }

  applySnapshot(snapshot, source) {
    if (!snapshot) return;
    const { metadata, waitingUsers = [], activeMatches = [] } = snapshot;

    if (metadata) {
      this.meta = {
        ...metadata,
        updatedAt: metadata.updatedAt ?? Date.now(),
        stats: metadata.stats ?? { joinCount: 0, matchCount: 0 },
      };
    }

    this.waitingUsers = Array.isArray(waitingUsers) ? waitingUsers : [];
    this.activeMatches = new Map();
    this.matchByUser = new Map();

    for (const match of Array.isArray(activeMatches) ? activeMatches : []) {
      this.activeMatches.set(match.sessionId, match);
      this.matchByUser.set(match.userId, match.sessionId);
      this.matchByUser.set(match.partnerId, match.sessionId);
    }

    this.isRestored = true;
    console.log(`[MatchQueueDO:${this.queueId}] Restored from ${source || "unknown"} snapshot`);
  }

  parseQueueKey(queueKey, fallbackFilters) {
    if (!queueKey) return fallbackFilters ?? {};
    const [, category, value] = queueKey.split(":");
    switch (category) {
      case "emotion":
        return { emotion: value };
      case "language":
        return { language: (value || "").toLowerCase() };
      case "mode":
        return { mode: value };
      default:
        return fallbackFilters ?? {};
    }
  }

  generateSessionId(userIdA, userIdB) {
    return `chat:${[userIdA, userIdB].sort().join(":")}`;
  }

  async bootstrapChatRoom(sessionId, payload) {
    if (!this.env.CHAT_ROOM) return;
    try {
      const roomId = this.env.CHAT_ROOM.idFromName(sessionId);
      const stub = this.env.CHAT_ROOM.get(roomId);
      const initPayload = {
        sessionId: sessionId,
        queueKey: payload.queueKey,
        filters: payload.filters,
        users: payload.users,
        createdAt: payload.createdAt,
      };
      console.log(`[MatchQueueDO:${this.queueId}] bootstrapping chat room`, {
        sessionId,
        queueKey: payload.queueKey,
        userIds: payload.users.map((u) => u.userId),
      });
      const response = await stub.fetch("https://chat-room/init", {
        method: "POST",
        body: JSON.stringify(initPayload),
        headers: { "Content-Type": "application/json" },
      });
      console.log(
        `[MatchQueueDO:${this.queueId}] bootstrap result`,
        sessionId,
        response.status,
      );
      if (!response.ok) {
        const text = await response.text();
        console.warn(
          `[MatchQueueDO:${this.queueId}] bootstrap returned non-200`,
          response.status,
          text,
        );
      }
    } catch (error) {
      console.error(`[MatchQueueDO:${this.queueId}] failed to initialise chat room ${sessionId}`, error);
    }
  }
}

