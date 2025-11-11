/**
 * Cloudflare Worker Entrypoint
 * Routes matchmaking to MatchQueueDO and WebSockets to ChatRoom DO
 */

import { ChatRoom, ChatRoomDO } from "./chat-room.js";
import { MatchQueueDO } from "./match-queue.js";

export { ChatRoom, ChatRoomDO, MatchQueueDO };

function parseAllowedOrigins(env) {
  const raw = env?.ALLOWED_ORIGINS;
  if (!raw || raw === "*") return "*";
  return String(raw)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function getCorsHeaders(origin, env) {
  const allowed = parseAllowedOrigins(env);
  const baseHeaders = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  };

  if (allowed === "*") {
    return { ...baseHeaders, "Access-Control-Allow-Origin": "*" };
  }

  if (origin && Array.isArray(allowed) && allowed.includes(origin)) {
    return {
      ...baseHeaders,
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
    };
  }

  // Default: reflect nothing, but don't block preflight
  return { ...baseHeaders, "Access-Control-Allow-Origin": "null", Vary: "Origin" };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: getCorsHeaders(request.headers.get("Origin"), env) });
    }

    try {
      // Join -> match -> chat: WebSocket traffic is handled by the ChatRoom DO.
      if (path === "/chat" && request.method === "GET") {
        return handleChatConnection(request, env);
      }

      // Disconnect -> cleanup: HTTP endpoint used by UI and server-side close handlers.
      if (path === "/chat/leave" && request.method === "POST") {
        return handleChatLeave(request, env);
      }

      if (path === "/health") {
        return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }

      // Matchmaking: /queue/* endpoints fan into the MatchQueue DO.
      if (path.startsWith("/queue/") || path.startsWith("/api/match")) {
        return handleQueueRouting(request, env, url);
      }

      return new Response("Not Found", { status: 404, headers: getCorsHeaders(request.headers.get("Origin"), env) });
    } catch (error) {
      console.error("[Worker] Error:", error);
      return new Response(
        JSON.stringify({ error: "Internal Server Error", message: error.message }),
        {
          status: 500,
          headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
        },
      );
    }
  },
};

async function handleQueueRouting(request, env, url) {
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (method === "POST" && (path === "/queue/join" || path === "/api/match")) {
    const body = await readJson(request);
    const queueKey = body.queueKey ?? deriveQueueKey(body);
    const wsProtocol = url.protocol === "https:" ? "wss" : "ws";
    const wsBase = url.host;
    const stub = getQueueStub(env, queueKey);

    const response = await stub.fetch("https://queue.internal/join", {
      method: "POST",
      body: JSON.stringify({
        ...body,
        queueKey,
        wsProtocol,
        wsBase,
      }),
      headers: { "Content-Type": "application/json" },
    });

    return adaptJoinResponse(response, wsProtocol, wsBase, request, env);
  }

  if (method === "POST" && path === "/queue/leave") {
    const body = await readJson(request);
    if (!body.queueKey) {
      return new Response(JSON.stringify({ error: "queueKey required" }), {
        status: 400,
        headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
      });
    }
    const stub = getQueueStub(env, body.queueKey);
    const response = await stub.fetch("https://queue.internal/leave", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    return withCors(response, request, env);
  }

  if (method === "GET" && path === "/queue/status") {
    const queueKey = url.searchParams.get("queueKey");
    if (!queueKey) {
      return new Response(JSON.stringify({ error: "queueKey required" }), {
        status: 400,
        headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
      });
    }
    const stub = getQueueStub(env, queueKey);
    const response = await stub.fetch("https://queue.internal/status", { method: "GET" });
    return withCors(response, request, env);
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
  });
}

async function handleChatConnection(request, env) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const userId = url.searchParams.get("userId");
  const userName = url.searchParams.get("userName") || "Stranger";

  if (!sessionId || !userId) {
    return new Response("Missing sessionId or userId", { status: 400 });
  }

  try {
    // Get or create Durable Object for this session
    const roomId = env.CHAT_ROOM.idFromName(sessionId);
    const room = env.CHAT_ROOM.get(roomId);

    // Forward the WebSocket upgrade request to the Durable Object
    // Add userId and userName to query params for the DO
    const doUrl = new URL(request.url);
    doUrl.searchParams.set("userId", userId);
    doUrl.searchParams.set("userName", userName);
    
    const doRequest = new Request(doUrl.toString(), request);
    return room.fetch(doRequest);
  } catch (error) {
    console.error("[Chat] Connection error:", error);
    return new Response(JSON.stringify({ error: "Failed to connect" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function handleChatLeave(request, env) {
  const payload = await readJson(request);
  const chatId = payload?.chatId;
  const userId = payload?.userId;

  if (!chatId || !userId) {
    return new Response(JSON.stringify({ error: "chatId and userId are required" }), {
      status: 400,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  }

  try {
    const room = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(chatId));
    const response = await room.fetch("https://chat-room/leave", {
      method: "POST",
      body: JSON.stringify({ userId }),
      headers: { "Content-Type": "application/json" },
    });
    return withCors(response, request, env);
  } catch (error) {
    console.error(`[Worker] Failed to forward /chat/leave for ${chatId}`, error);
    return new Response(
      JSON.stringify({ error: "Failed to process leave request" }),
      { status: 500, headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" } },
    );
  }
}

function getQueueStub(env, queueKey) {
  const id = env.MATCH_QUEUE.idFromName(queueKey);
  return env.MATCH_QUEUE.get(id);
}

function deriveQueueKey({ emotion, language, mode }) {
  if (emotion) return `queue:emotion:${emotion}`;
  if (language) return `queue:language:${language.toLowerCase()}`;
  if (mode) return `queue:mode:${mode}`;
  return "queue:default";
}

async function readJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_err) {
    return {};
  }
}

async function adaptJoinResponse(response, wsProtocol, wsBase, request, env) {
  let payload;
  try {
    payload = await response.json();
  } catch (_err) {
    // Fall back to passthrough with CORS if response is not JSON
    return withCors(response, request, env);
  }

  if (payload?.matched) {
    const sessionId = payload.sessionId;
    const userId = payload.userId ?? payload.requestingUserId ?? null;
    const queueKey = payload.queueKey ?? null;
    if (!payload.wsUrl && sessionId && userId) {
      const queueKeyParam = queueKey ? `&queueKey=${encodeURIComponent(queueKey)}` : "";
      payload.wsUrl = `${wsProtocol}://${wsBase}/chat?sessionId=${encodeURIComponent(sessionId)}&userId=${encodeURIComponent(userId)}${queueKeyParam}`;
    }
  }

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json");
  const cors = getCorsHeaders(request.headers.get("Origin"), env);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }

  return new Response(JSON.stringify(payload), {
    status: response.status,
    headers,
  });
}

function withCors(response, request, env) {
  const headers = new Headers(response.headers);
  const cors = getCorsHeaders(request.headers.get("Origin"), env);
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

