/**
 * Cloudflare Worker Entrypoint
 * Handles matchmaking and routes WebSocket connections to ChatRoom Durable Objects
 */

import { ChatRoom } from "./chat-room.js";

// Export ChatRoom Durable Object class
export { ChatRoom };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Matchmaking endpoint
      if (path === "/api/match" && request.method === "POST") {
        return handleMatchmaking(request, env, corsHeaders);
      }

      // WebSocket connection to chat room
      if (path === "/chat" && request.method === "GET") {
        return handleChatConnection(request, env);
      }

      // Health check
      if (path === "/health") {
        return new Response(JSON.stringify({ status: "ok", timestamp: Date.now() }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error("[Worker] Error:", error);
      return new Response(
        JSON.stringify({ error: "Internal Server Error", message: error.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  },
};

/**
 * Handle matchmaking request
 * Queue users in KV and pair them when a match is found
 */
async function handleMatchmaking(request, env, corsHeaders) {
  try {
    const body = await request.json();
    const { userId, userName, deviceId, emotion, language, mode } = body;

    if (!userId || !userName) {
      return new Response(
        JSON.stringify({ error: "userId and userName are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build queue key based on emotion, language, or mode (needed for checking if user is in queue)
    const queueKey = emotion
      ? `queue:emotion:${emotion}`
      : language
      ? `queue:language:${language}`
      : mode === "emoji"
      ? "queue:emoji"
      : "queue:default";
    const queueListKey = `${queueKey}:list`;
    
    // Ensure user has exactly one partner: check if already paired
    // If pairing exists and is still valid (not expired and partner still paired with us), return it
    // This ensures both User A and User B get notified of the match when they poll
    const existingPair = await env.MATCH_QUEUE.get(`paired:${userId}`);
    if (existingPair) {
      const pairData = JSON.parse(existingPair);
      const pairAge = Date.now() - (pairData.timestamp || 0);
      const pairTTL = 60000; // 60 seconds - matches the expiration TTL when pair was created
      
      // Check if pair is still valid (not expired)
      if (pairData.sessionId && pairData.partnerId && pairAge < pairTTL) {
        // Verify mutual pairing: check if partner is still paired with us (not clicked Next)
        const partnerPair = await env.MATCH_QUEUE.get(`paired:${pairData.partnerId}`);
        const isMutualPair = partnerPair && JSON.parse(partnerPair).partnerId === userId;
        
        if (isMutualPair) {
          // Pair is valid and mutual - return match result
          // IMPORTANT: Return pair regardless of queue status because:
          // 1. When match is found, both users are removed from queue
          // 2. User B might poll after being removed from queue but before receiving notification
          // 3. We should return the valid mutual pair to ensure both users get notified
          console.log(`[Matchmaking] User ${userId} already paired (matched ${pairAge}ms ago, mutual pair confirmed), returning match info`, pairData);
          
          // Check queue status for logging only
          const waitingUserIds = await getQueueList(env.MATCH_QUEUE, queueListKey);
          const isInQueue = waitingUserIds.includes(userId);
          console.log(`[Matchmaking] Pair is valid and mutual, user in queue: ${isInQueue} (removed when matched, this is expected)`);
          
          // Build WebSocket URL
          const workerUrl = new URL(request.url);
          const protocol = workerUrl.protocol === "https:" ? "wss" : "ws";
          const wsBase = workerUrl.host;
          const wsUrl = `${protocol}://${wsBase}/chat?sessionId=${pairData.sessionId}&userId=`;
          
          // Clean up: remove user from queue if they're still there (shouldn't be, but safe)
          if (isInQueue) {
            await Promise.all([
              env.MATCH_QUEUE.delete(userId),
              updateQueueList(env.MATCH_QUEUE, queueListKey, waitingUserIds.filter(id => id !== userId)),
            ]);
          }
          
          return new Response(
            JSON.stringify({
              success: true,
              matched: true,
              sessionId: pairData.sessionId,
              partnerId: pairData.partnerId,
              partnerName: pairData.partnerName || "Stranger",
              wsUrl: `${wsUrl}${userId}&userName=${encodeURIComponent(userName)}`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        } else {
          // Partner is no longer paired with us (they clicked Next or disconnected)
          console.log(`[Matchmaking] User ${userId} has stale pairing - partner ${pairData.partnerId} no longer paired with us, clearing`);
          await env.MATCH_QUEUE.delete(`paired:${userId}`);
          // Also clear partner's pairing if it references us
          if (pairData.partnerId) {
            const partnerPair = await env.MATCH_QUEUE.get(`paired:${pairData.partnerId}`);
            if (partnerPair) {
              const partnerPairData = JSON.parse(partnerPair);
              if (partnerPairData.partnerId === userId) {
                await env.MATCH_QUEUE.delete(`paired:${pairData.partnerId}`);
              }
            }
          }
        }
      } else {
        // Pairing is expired (older than TTL) - clear it for new match
        console.log(`[Matchmaking] User ${userId} pairing expired (age: ${pairAge}ms, TTL: ${pairTTL}ms), clearing for new matchmaking`);
        await env.MATCH_QUEUE.delete(`paired:${userId}`);
        // Also clear partner's pairing if it references us
        if (pairData.partnerId) {
          const partnerPair = await env.MATCH_QUEUE.get(`paired:${pairData.partnerId}`);
          if (partnerPair) {
            const partnerPairData = JSON.parse(partnerPair);
            if (partnerPairData.partnerId === userId) {
              await env.MATCH_QUEUE.delete(`paired:${pairData.partnerId}`);
            }
          }
        }
      }
      
      // Continue to find new partner if pair was invalid/expired
    }

    console.log(`[Matchmaking] User ${userId} (${userName}) searching in queue: ${queueKey}`);

    // Check for existing waiting users
    const waitingUserIds = await getQueueList(env.MATCH_QUEUE, queueListKey);
    console.log(`[Matchmaking] Queue ${queueKey} has ${waitingUserIds.length} waiting users:`, waitingUserIds);
    
    // Remove current user from queue if already there
    const filteredQueue = waitingUserIds.filter(id => id !== userId);
    
    // Try to match with first available user
    let partnerId = null;
    let partnerData = null;

    for (const candidateId of filteredQueue) {
      // CRITICAL: Verify candidate is actually still in queue (not removed by another matchmaking request)
      // This prevents matching with users who were just matched to someone else
      const isInQueue = waitingUserIds.includes(candidateId) || filteredQueue.includes(candidateId);
      if (!isInQueue) {
        console.log(`[Matchmaking] Skipping candidate ${candidateId} - no longer in queue (matched to someone else)`);
        continue;
      }

      // Enforce one-partner rule: check if candidate is already paired
      // Only skip if pairing is very recent (< 3 seconds) - older pairings are stale and should be cleared
      const candidatePaired = await env.MATCH_QUEUE.get(`paired:${candidateId}`);
      if (candidatePaired) {
        const pairData = JSON.parse(candidatePaired);
        const pairAge = Date.now() - (pairData.timestamp || 0);
        // Only skip if pairing is very recent (< 3 seconds) - ensures one active partner
        if (pairAge < 3000) {
          console.log(`[Matchmaking] Skipping candidate ${candidateId} - already has active partner (paired ${pairAge}ms ago)`);
          continue;
        } else {
          // Clear stale pairing to enforce one-partner rule
          console.log(`[Matchmaking] Candidate ${candidateId} has stale pairing (${pairAge}ms old), clearing and considering for match`);
          await env.MATCH_QUEUE.delete(`paired:${candidateId}`);
        }
      }

      // Get candidate's data and verify they're still available
      const candidateDataStr = await env.MATCH_QUEUE.get(candidateId);
      if (candidateDataStr) {
        const candidateData = JSON.parse(candidateDataStr);
        // Ensure they're still waiting (not expired) AND still in queue
        const candidateAge = Date.now() - candidateData.timestamp;
        if (candidateAge < 60000) { // 60 second TTL check
          // Double-check candidate is still in queue (race condition protection)
          const currentQueueList = await getQueueList(env.MATCH_QUEUE, queueListKey);
          if (currentQueueList.includes(candidateId)) {
            partnerId = candidateId;
            partnerData = candidateData;
            console.log(`[Matchmaking] Found valid candidate: ${candidateId} (waiting for ${candidateAge}ms)`);
            break;
          } else {
            console.log(`[Matchmaking] Candidate ${candidateId} was removed from queue during matching (race condition)`);
          }
        } else {
          console.log(`[Matchmaking] Candidate ${candidateId} expired (${candidateAge}ms old)`);
        }
      } else {
        console.log(`[Matchmaking] Candidate ${candidateId} data not found in queue`);
      }
    }

    if (partnerId && partnerData) {
      // Match found! Create chat room
      const sessionId = generateSessionId(userId, partnerId);
      console.log(`[Matchmaking] ✅ MATCH FOUND! Pairing ${userId} with ${partnerId}, sessionId: ${sessionId}`);
      const roomId = env.CHAT_ROOM.idFromName(sessionId);
      const room = env.CHAT_ROOM.get(roomId);

      // Store pairing information (30 second TTL)
      const pairData = {
        sessionId,
        userId1: userId,
        userId2: partnerId,
        userName1: userName,
        userName2: partnerData.userName || "Stranger",
        timestamp: Date.now(),
      };

      // Mark both users as paired (store emotion/language/mode for matching criteria check)
      await Promise.all([
        env.MATCH_QUEUE.put(`paired:${userId}`, JSON.stringify({
          sessionId,
          partnerId,
          partnerName: partnerData.userName || "Stranger",
          emotion: partnerData.emotion || null,
          language: partnerData.language || null,
          mode: partnerData.mode || null,
          timestamp: Date.now(),
        }), { expirationTtl: 60 }),
        env.MATCH_QUEUE.put(`paired:${partnerId}`, JSON.stringify({
          sessionId,
          partnerId: userId,
          partnerName: userName,
          emotion: emotion || null,
          language: language || null,
          mode: mode || null,
          timestamp: Date.now(),
        }), { expirationTtl: 60 }),
      ]);

      // Clean up queue entries
      await Promise.all([
        env.MATCH_QUEUE.delete(userId),
        env.MATCH_QUEUE.delete(partnerId),
        updateQueueList(env.MATCH_QUEUE, queueListKey, filteredQueue.filter(id => id !== partnerId)),
      ]);

      // Build WebSocket URL - use the worker's own URL, not the request origin
      const workerUrl = new URL(request.url);
      const protocol = workerUrl.protocol === "https:" ? "wss" : "ws";
      const wsBase = workerUrl.host; // Use worker's host (e.g., localhost:8787 or your-worker.workers.dev)
      const wsUrl = `${protocol}://${wsBase}/chat?sessionId=${sessionId}&userId=`;

      console.log(`[Matchmaking] Matched ${userId} with ${partnerId}, sessionId: ${sessionId}`);
      console.log(`[Matchmaking] WebSocket URL: ${wsUrl}`);

      return new Response(
        JSON.stringify({
          success: true,
          matched: true,
          sessionId,
          partnerId,
          partnerName: partnerData.userName || "Stranger",
          wsUrl: `${wsUrl}${userId}&userName=${encodeURIComponent(userName)}`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // No match found, add to queue (only if not already in queue)
    // Check if user is already in the queue to avoid duplicates
    const isAlreadyInQueue = waitingUserIds.includes(userId);
    
    if (!isAlreadyInQueue) {
      const userData = {
        userId,
        userName,
        deviceId,
        emotion,
        language,
        mode,
        timestamp: Date.now(),
      };

      await Promise.all([
        env.MATCH_QUEUE.put(userId, JSON.stringify(userData), { expirationTtl: 60 }),
        updateQueueList(env.MATCH_QUEUE, queueListKey, [...filteredQueue, userId]),
      ]);

      console.log(`[Matchmaking] Queued user ${userId} in ${queueKey}`);
    } else {
      // User already in queue, just update their data timestamp to keep them alive
      const existingDataStr = await env.MATCH_QUEUE.get(userId);
      if (existingDataStr) {
        const existingData = JSON.parse(existingDataStr);
        existingData.timestamp = Date.now(); // Update timestamp
        await env.MATCH_QUEUE.put(userId, JSON.stringify(existingData), { expirationTtl: 60 });
        console.log(`[Matchmaking] User ${userId} already in queue, updated timestamp`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        matched: false,
        message: "Waiting for partner...",
        queueKey,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[Matchmaking] Error:", error);
    return new Response(
      JSON.stringify({ error: "Matchmaking failed", message: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}

/**
 * Handle WebSocket connection to chat room
 */
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

/**
 * Generate deterministic session ID from two user IDs
 */
function generateSessionId(userId1, userId2) {
  const sorted = [userId1, userId2].sort();
  return `chat:${sorted[0]}:${sorted[1]}`;
}

/**
 * Get list of user IDs from queue (stored as JSON in KV)
 */
async function getQueueList(kv, key) {
  const data = await kv.get(key);
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/**
 * Update queue list in KV
 */
async function updateQueueList(kv, key, userIds) {
  if (userIds.length === 0) {
    await kv.delete(key);
  } else {
    await kv.put(key, JSON.stringify(userIds), { expirationTtl: 60 });
  }
}

