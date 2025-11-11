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

    // Attach ctx to global for caching helpers if not provided
    try { globalThis.ctx = ctx; } catch (_err) {}

    // Basic API rate limiting for /api/* endpoints
    if (path.startsWith("/api/")) {
      const rl = await rateLimit(request, env);
      if (!rl.ok) {
        return new Response(JSON.stringify({ error: "Rate limited" }), {
          status: 429,
          headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
        });
      }
    }

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

      if (path === "/health" || path === "/api/health") {
        // Cache health briefly to absorb bursts
        const cache = caches.default;
        const cacheKey = new Request(request.url, request);
        const cached = await cache.match(cacheKey);
        if (cached) {
          return new Response(cached.body, {
            status: cached.status,
            headers: { ...Object.fromEntries(cached.headers), ...getCorsHeaders(request.headers.get("Origin"), env) },
          });
        }
        const res = new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
          headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json", "Cache-Control": "public, max-age=15" },
        });
        ctx.waitUntil(cache.put(cacheKey, res.clone()));
        return res;
      }

      // Session issuance
      if (path === "/api/session" && request.method === "POST") {
        return handleSession(request, env);
      }

      // Feedback submit (migrated to D1)
      if (path === "/api/feedback" && request.method === "POST") {
        return handleFeedbackCreate(request, env);
      }

      // Turnstile verification
      if (path === "/api/verify-turnstile" && request.method === "POST") {
        return handleTurnstile(request, env);
      }

      // FAQs: read + write on D1
      if (path === "/api/faqs" && request.method === "GET") {
        return handleFaqList(request, env);
      }
      if (path.startsWith("/api/faqs/") && request.method === "GET") {
        return handleFaqGet(request, env);
      }
      if (path === "/api/faqs" && request.method === "POST") {
        return handleFaqCreate(request, env);
      }
      if (path.startsWith("/api/faqs/") && request.method === "PUT") {
        return handleFaqUpdate(request, env);
      }
      if (path.startsWith("/api/faqs/") && request.method === "DELETE") {
        return handleFaqDelete(request, env);
      }

      // Matchmaking: /queue/* endpoints fan into the MatchQueue DO.
      if (path.startsWith("/queue/") || path.startsWith("/api/match")) {
        if (path.startsWith("/api/match") && String(env.USE_WORKER_MATCHMAKING || "true") !== "true") {
          return forwardToOrigin(request, env);
        }
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

function getClientIp(request) {
  return request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "0.0.0.0";
}

async function rateLimit(request, env) {
  try {
    if (!env.APP_KV) return { ok: true };
    const ip = getClientIp(request);
    const now = new Date();
    const key = `rl:${ip}:${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}${String(now.getUTCHours()).padStart(2, "0")}`;
    const raw = await env.APP_KV.get(key);
    const count = Number(raw || "0");
    if (count > 2000) return { ok: false };
    await env.APP_KV.put(key, String(count + 1), { expirationTtl: 3700 });
    return { ok: true };
  } catch (_err) {
    return { ok: true };
  }
}

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

    // Observability: matched event
    try {
      env.AE?.writeDataPoint({
        blobs: ["match", queueKey || "unknown"],
        doubles: [1],
      });
    } catch (_err) {}
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

async function forwardToOrigin(request, env) {
  if (!env.ORIGIN_URL) {
    return new Response(JSON.stringify({ error: "ORIGIN_URL not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const incomingUrl = new URL(request.url);
  const target = new URL(env.ORIGIN_URL);
  target.pathname = incomingUrl.pathname;
  target.search = incomingUrl.search;
  return fetch(target.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
}

async function handleSession(request, env) {
  try {
    const ttl = Number(env.SESSION_TTL_SECONDS || "7200");
    const token = crypto.randomUUID();
    if (env.APP_KV) {
      await env.APP_KV.put(`sess:${token}`, "1", { expirationTtl: ttl });
    }
    const headers = {
      ...getCorsHeaders(request.headers.get("Origin"), env),
      "Content-Type": "application/json",
      "Set-Cookie": `sid=${token}; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=${ttl}`,
    };
    return new Response(JSON.stringify({ ok: true, sid: token }), { status: 200, headers });
  } catch (error) {
    console.error("[Session] error", error);
    return new Response(JSON.stringify({ error: "Failed to create session" }), {
      status: 500,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  }
}

async function handleFeedbackCreate(request, env) {
  try {
    const { feedbackText } = await readJson(request);
    const text = typeof feedbackText === "string" ? feedbackText.trim() : "";
    if (!text) {
      return new Response(JSON.stringify({ error: "Feedback text is required" }), {
        status: 400,
        headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
      });
    }
    if (text.length > 2000) {
      return new Response(JSON.stringify({ error: "Feedback text is too long (max 2000 characters)" }), {
        status: 400,
        headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
      });
    }

    // Insert with monotonically increasing sequence starting from 1.
    // Uses a single-statement subquery to compute next value:
    // sequence_idc = (SELECT COALESCE(MAX(sequence_idc), 0) + 1 FROM feedback)
    // If there is a UNIQUE constraint on sequence_idc, retry on conflict briefly.
    let attempts = 0;
    let seqId = null;
    while (attempts < 3) {
      attempts += 1;
      try {
        const stmt = env.DB
          .prepare("INSERT INTO feedback (sequence_idc, feedback_text) VALUES ((SELECT COALESCE(MAX(sequence_idc), 0) + 1 FROM feedback), ?1)")
          .bind(text);
        const res = await stmt.run();
        // Some D1 versions don't expose the selected value; fetch the last inserted row to get sequence_idc.
        const row = await env.DB.prepare("SELECT sequence_idc FROM feedback WHERE rowid = last_insert_rowid()").first();
        seqId = row?.sequence_idc ?? null;
        break;
      } catch (e) {
        const msg = String(e?.message || "");
        const isConflict = msg.includes("UNIQUE") || msg.includes("constraint");
        if (!isConflict) throw e;
        // brief backoff before retry
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    return new Response(JSON.stringify({ success: true, message: "Thank you for your feedback!", sequence_idc: seqId }), {
      status: 200,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[Feedback] create error", err);
    return new Response(JSON.stringify({ error: "Failed to submit feedback. Please try again later." }), {
      status: 500,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  }
}

async function handleTurnstile(request, env) {
  try {
    const { token } = await readJson(request);
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: "missing token" }), {
        status: 400,
        headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
      });
    }
    const secret = env.TURNSTILE_SECRET_KEY || "";
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    const result = await resp.json();
    const ok = !!result?.success;
    return new Response(JSON.stringify({ ok }), {
      status: ok ? 200 : 400,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Turnstile] error", error);
    return new Response(JSON.stringify({ ok: false, error: "verification failed" }), {
      status: 500,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  }
}

async function handleReadOnlyProxy(request, env) {
  if (!env.ORIGIN_URL) {
    return new Response(JSON.stringify({ error: "ORIGIN_URL not configured" }), {
      status: 500,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  }
  try {
    // Cache GETs at the edge briefly
    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    const cached = await cache.match(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: { ...Object.fromEntries(cached.headers), ...getCorsHeaders(request.headers.get("Origin"), env) },
      });
    }

    const originUrl = new URL(request.url);
    const target = new URL(env.ORIGIN_URL);
    target.pathname = originUrl.pathname;
    target.search = originUrl.search;

    const resp = await fetch(target.toString(), { headers: { accept: "application/json" } });
    const headers = new Headers(resp.headers);
    headers.set("Content-Type", "application/json");
    headers.set("Cache-Control", "public, max-age=60");
    const cors = getCorsHeaders(request.headers.get("Origin"), env);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);

    const out = new Response(resp.body, { status: resp.status, headers });
    ctxTryWait(request, async () => cache.put(cacheKey, out.clone()));
    return out;
  } catch (error) {
    console.error("[Proxy] read-only error", error);
    return new Response(JSON.stringify({ error: "Failed to proxy request" }), {
      status: 502,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  }
}

function ctxTryWait(request, fn) {
  try {
    // @ts-ignore - execution context may be attached by platforms, fallback no-op
    const ctx = request?.cf?.ctx || globalThis?.ctx;
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(fn());
      return;
    }
  } catch (_err) {}
  // Fallback: fire and forget
  fn().catch(() => {});
}

// ========== FAQ Handlers (D1) ==========
async function handleFaqList(request, env) {
  try {
    const url = new URL(request.url);
    const search = (url.searchParams.get("search") || "").trim();
    const category = (url.searchParams.get("category") || "").trim().toLowerCase();

    const cache = caches.default;
    const cacheKey = new Request(request.url, request);
    const cached = await cache.match(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        status: cached.status,
        headers: { ...Object.fromEntries(cached.headers), ...getCorsHeaders(request.headers.get("Origin"), env) },
      });
    }

    let query = "SELECT id, question, answer, category, \"order\", created_at, updated_at FROM faqs";
    const where = [];
    const binds = [];
    if (search) {
      where.push("(question LIKE ?1 OR answer LIKE ?2)");
      binds.push(`%${escapeLike(search)}%`, `%${escapeLike(search)}%`);
    }
    if (category) {
      where.push("LOWER(category) = ?");
      binds.push(category);
    }
    if (where.length) {
      query += " WHERE " + where.join(" AND ");
    }
    query += " ORDER BY \"order\" ASC, created_at DESC";

    const stmt = env.DB.prepare(query).bind(...binds);
    const { results } = await stmt.all();
    const body = {
      success: true,
      faqs: results.map(rowToFaq),
    };
    const res = new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
    });
    ctxTryWait(request, async () => cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    console.error("[FAQ] list error", err);
    return new Response(JSON.stringify({ error: "Failed to fetch FAQs" }), {
      status: 500,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  }
}

async function handleFaqGet(request, env) {
  try {
    const idStr = request.url.split("/").pop();
    const id = Number(idStr);
    if (!Number.isInteger(id)) {
      return new Response(JSON.stringify({ error: "Invalid FAQ ID" }), {
        status: 400,
        headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
      });
    }
    const stmt = env.DB.prepare('SELECT id, question, answer, category, "order", created_at, updated_at FROM faqs WHERE id = ?').bind(id);
    const row = await stmt.first();
    if (!row) {
      return new Response(JSON.stringify({ error: "FAQ not found" }), {
        status: 404,
        headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true, faq: rowToFaq(row) }), {
      status: 200,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
    });
  } catch (err) {
    console.error("[FAQ] get error", err);
    return new Response(JSON.stringify({ error: "Failed to fetch FAQ" }), {
      status: 500,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  }
}

async function handleFaqCreate(request, env) {
  try {
    const { question, answer, category, order } = await readJson(request);
    const q = typeof question === "string" ? question.trim() : "";
    const a = typeof answer === "string" ? answer.trim() : "";
    if (!q) return jsonBadRequest(request, env, "Question is required");
    if (!a) return jsonBadRequest(request, env, "Answer is required");
    const validCategories = ["general", "account", "safety", "features", "support"];
    const cat = (typeof category === "string" ? category.trim().toLowerCase() : "general");
    const finalCategory = validCategories.includes(cat) ? cat : "general";
    const ord = Number.isInteger(order) ? order : 0;
    const now = Date.now();
    const stmt = env.DB.prepare('INSERT INTO faqs (question, answer, category, "order", created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
      .bind(q, a, finalCategory, ord, now, now);
    const result = await stmt.run();
    const id = result.meta.last_row_id;
    return new Response(JSON.stringify({ success: true, message: "FAQ created successfully!", faqId: id, faq: { id, question: q, answer: a, category: finalCategory, order: ord, createdAt: now, updatedAt: now } }), {
      status: 200,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[FAQ] create error", err);
    return new Response(JSON.stringify({ error: "Failed to create FAQ" }), {
      status: 500,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  }
}

async function handleFaqUpdate(request, env) {
  try {
    const idStr = request.url.split("/").pop();
    const id = Number(idStr);
    if (!Number.isInteger(id)) {
      return jsonBadRequest(request, env, "Invalid FAQ ID");
    }
    const payload = await readJson(request);
    const validCategories = ["general", "account", "safety", "features", "support"];

    // Load existing
    const existing = await env.DB.prepare('SELECT id, question, answer, category, "order", created_at, updated_at FROM faqs WHERE id = ?').bind(id).first();
    if (!existing) {
      return new Response(JSON.stringify({ error: "FAQ not found" }), {
        status: 404,
        headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
      });
    }
    const q = payload.question !== undefined ? String(payload.question || "").trim() : existing.question;
    const a = payload.answer !== undefined ? String(payload.answer || "").trim() : existing.answer;
    let c = existing.category;
    if (payload.category !== undefined) {
      const cat = String(payload.category || "").trim().toLowerCase();
      if (validCategories.includes(cat)) c = cat;
    }
    const ord = payload.order !== undefined && Number.isInteger(payload.order) ? payload.order : existing["order"];
    const now = Date.now();
    await env.DB.prepare('UPDATE faqs SET question = ?1, answer = ?2, category = ?3, "order" = ?4, updated_at = ?5 WHERE id = ?6')
      .bind(q, a, c, ord, now, id)
      .run();
    const faq = { id, question: q, answer: a, category: c, order: ord, createdAt: existing.created_at, updatedAt: now };
    return new Response(JSON.stringify({ success: true, message: "FAQ updated successfully!", faq }), {
      status: 200,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[FAQ] update error", err);
    return new Response(JSON.stringify({ error: "Failed to update FAQ" }), {
      status: 500,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  }
}

async function handleFaqDelete(request, env) {
  try {
    const idStr = request.url.split("/").pop();
    const id = Number(idStr);
    if (!Number.isInteger(id)) {
      return jsonBadRequest(request, env, "Invalid FAQ ID");
    }
    const res = await env.DB.prepare("DELETE FROM faqs WHERE id = ?").bind(id).run();
    if ((res.meta.changes || 0) === 0) {
      return new Response(JSON.stringify({ error: "FAQ not found" }), {
        status: 404,
        headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ success: true, message: "FAQ deleted successfully!" }), {
      status: 200,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[FAQ] delete error", err);
    return new Response(JSON.stringify({ error: "Failed to delete FAQ" }), {
      status: 500,
      headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
    });
  }
}

function rowToFaq(row) {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    category: row.category,
    order: row["order"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function escapeLike(s) {
  return s.replace(/[%_]/g, "\\$&");
}

function jsonBadRequest(request, env, message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { ...getCorsHeaders(request.headers.get("Origin"), env), "Content-Type": "application/json" },
  });
}

