/**
 * ChatRoom Durable Object
 * Handles WebSocket connections for a pair of users
 * Auto-cleans up after 5 minutes of inactivity or when both users disconnect
 */
export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clients = new Set();
    this.messages = [];
    this.userIds = new Set();
    this.userNames = new Map(); // userId -> userName
    this.lastActivity = Date.now();
    this.alarmScheduled = false;
    this.idleTimeout = 5 * 60 * 1000; // 5 minutes
    this.messageLimit = 20; // Keep last 20 messages in memory
    this.nextCleanupTimeout = null; // Track cleanup timeout for proper cancellation
    this.pendingDisconnects = new Map(); // Track pending disconnect notifications: userId -> timeoutId
    this.disconnectGracePeriod = 5000; // 5 seconds grace period before notifying partner
    
    // Initialize alarm handler
    this.state.storage.setAlarm(Date.now() + this.idleTimeout).catch(console.error);
    this.alarmScheduled = true;
  }

  async fetch(request) {
    // Only accept WebSocket upgrade requests
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    try {
      // Create WebSocket pair
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      // Accept the server WebSocket
      this.handleSession(server, request);

      // Return the client WebSocket with upgrade headers
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: {
          "Upgrade": "websocket",
          "Connection": "Upgrade",
        },
      });
    } catch (error) {
      console.error("ChatRoom fetch error:", error);
      return new Response(JSON.stringify({ error: "WebSocket error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  handleSession(ws, request) {
    ws.accept();
    
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const userName = url.searchParams.get("userName") || "Stranger";
    
    // If this user reconnects, cancel any pending disconnect notification
    if (userId && this.pendingDisconnects.has(userId)) {
      console.log(`[ChatRoom] User ${userId} reconnected, canceling pending disconnect notification`);
      clearTimeout(this.pendingDisconnects.get(userId));
      this.pendingDisconnects.delete(userId);
    }
    
    if (userId) {
      this.userIds.add(userId);
      this.userNames.set(userId, userName);
    }

    // Store WebSocket with metadata
    ws.userId = userId;
    ws.connectedAt = Date.now();
    
    this.clients.add(ws);
    this.lastActivity = Date.now();
    this.resetAlarm();

    console.log(`[ChatRoom] Client connected: userId=${userId}, total=${this.clients.size}`);

    // Send existing messages to new client (last 20)
    if (this.messages.length > 0) {
      const recentMessages = this.messages.slice(-this.messageLimit);
      ws.send(JSON.stringify({ type: "history", messages: recentMessages }));
    }

    // Validate session: ensure we have exactly 2 users before allowing chat
    // If only 1 user connects, wait for partner (don't notify partner_found yet)
    // Only notify when both users are connected
    if (this.clients.size === 1) {
      // First user connected, wait for partner
      console.log(`[ChatRoom] First user ${userId} connected, waiting for partner...`);
      // Don't send any notifications yet - wait for partner
    } else if (this.clients.size === 2 && userId) {
      // Both users connected - session is valid
      console.log(`[ChatRoom] Both users connected! Session is active.`);
      
      // Find the other user (partner) - the one who is NOT the newly connected user
      const otherClient = Array.from(this.clients).find(client => client !== ws && client.userId);
      const otherUserId = otherClient?.userId;
      const otherUserName = otherClient ? (this.userNames.get(otherUserId) || "Stranger") : "Stranger";
      
      // CRITICAL: Send partner_connected to BOTH users:
      // 1. Send to the newly connected user (User B) with the first user's info
      // 2. Send to the first user (User A) with the newly connected user's info
      if (otherUserId && otherClient) {
        // Send to newly connected user (User B) - notify them about User A
        if (ws.readyState === WebSocket.READY_STATE_OPEN) {
          ws.send(JSON.stringify({
            type: "partner_connected",
            userId: otherUserId,
            userName: otherUserName,
            timestamp: Date.now(),
          }));
          console.log(`[ChatRoom] ✅ Sent partner_connected to newly connected user ${userId} about partner ${otherUserId}`);
        }
        
        // Send to first user (User A) - notify them about User B
        if (otherClient.readyState === WebSocket.READY_STATE_OPEN) {
          otherClient.send(JSON.stringify({
            type: "partner_connected",
            userId: userId,
            userName: userName,
            timestamp: Date.now(),
          }));
          console.log(`[ChatRoom] ✅ Sent partner_connected to first user ${otherUserId} about newly connected partner ${userId}`);
        }
      } else {
        // Fallback: Use broadcast if we can't find the other client
        console.warn(`[ChatRoom] Could not find other client, using broadcast fallback`);
        this.broadcast({
          type: "partner_connected",
          userId,
          userName,
          timestamp: Date.now(),
        }, ws);
      }
    } else if (this.clients.size > 2) {
      // More than 2 clients - this shouldn't happen, reject new connection
      console.warn(`[ChatRoom] Too many clients (${this.clients.size}), rejecting connection from ${userId}`);
      ws.close(1008, "Chat room already full");
      this.clients.delete(ws);
      return;
    }

    // Handle incoming messages
    ws.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data, ws);
      } catch (error) {
        console.error("[ChatRoom] Message parse error:", error);
        ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      }
    });

    // Handle close
    ws.addEventListener("close", () => {
      this.handleClose(ws);
    });

    // Handle errors
    ws.addEventListener("error", (error) => {
      console.error("[ChatRoom] WebSocket error:", error);
      this.handleClose(ws);
    });
  }

  handleMessage(data, ws) {
    this.lastActivity = Date.now();
    this.resetAlarm();

    switch (data.type) {
      case "chatMessage":
        this.handleChatMessage(data, ws);
        break;
      case "heartbeat":
        // Keep-alive ping
        ws.send(JSON.stringify({ type: "heartbeat_ack", timestamp: Date.now() }));
        break;
      case "partner_found":
        // Already handled by matchmaking
        break;
      case "next":
        // User clicked Next button OR browser navigation (back/refresh/close)
        // Notify partner and cleanup
        const reason = data.reason || "User clicked Next";
        console.log(`[ChatRoom] Received "next" message from ${ws.userId || 'unknown'}, reason: ${reason}`);
        this.handleNext(ws, reason);
        break;
      default:
        console.warn("[ChatRoom] Unknown message type:", data.type);
    }
  }

  handleNext(ws, reason = "User clicked Next") {
    const userId = ws.userId;
    const userName = this.userNames.get(userId) || "Stranger";
    
    console.log(`[ChatRoom] User ${userId} leaving (${reason}), notifying partner and closing all connections`);
    
    // Cancel any pending disconnect notification for this user (if exists)
    if (userId && this.pendingDisconnects.has(userId)) {
      console.log(`[ChatRoom] Canceling pending disconnect notification for ${userId} (user clicked Next)`);
      clearTimeout(this.pendingDisconnects.get(userId));
      this.pendingDisconnects.delete(userId);
    }
    
    // Notify the partner that this user has left BEFORE closing connections
    // This ensures the partner receives the notification immediately
    if (this.clients.size > 1) {
      const isBrowserNavigation = reason.includes("Browser");
      
      // Send partner_left message (for re-queuing logic)
      // IMPORTANT: Even for browser navigation, User B should auto-requeue
      // User A (who closed browser) will navigate away and NOT be re-queued (handled client-side)
      const partnerMessage = {
        type: "partner_left",
        userId,
        userName,
        timestamp: Date.now(),
        reason: isBrowserNavigation ? reason : "Partner clicked Next",
        autoRequeue: true, // Always auto-requeue User B, regardless of how User A left
      };
      
      // Send room_closed message for browser navigation to force partner to leave completely
      const roomClosedMessage = isBrowserNavigation ? {
        type: "room_closed",
        reason: "Partner left via browser navigation - session terminated",
        timestamp: Date.now(),
      } : null;
      
      // Send messages to all other clients (the partner)
      const otherClients = Array.from(this.clients).filter(client => client !== ws);
      console.log(`[ChatRoom] Sending notifications to ${otherClients.length} partner(s)`);
      
      for (const client of otherClients) {
        if (client.readyState === WebSocket.READY_STATE_OPEN) {
          try {
            // Always send partner_left FIRST
            client.send(JSON.stringify(partnerMessage));
            console.log(`[ChatRoom] ✅ Sent partner_left to partner ${client.userId}`);
            
            // If browser navigation, also send room_closed to force partner to navigate away
            if (roomClosedMessage) {
              // Small delay between messages to ensure both are received
              setTimeout(() => {
                if (client.readyState === WebSocket.READY_STATE_OPEN) {
                  try {
                    client.send(JSON.stringify(roomClosedMessage));
                    console.log(`[ChatRoom] ✅ Sent room_closed to partner ${client.userId} (browser navigation detected)`);
                  } catch (error) {
                    console.error("[ChatRoom] Error sending room_closed message:", error);
                  }
                }
              }, 50); // 50ms delay between messages
            }
            
            // Mark that this partner's disconnect should not trigger a grace period
            const partnerUserId = client.userId;
            if (partnerUserId) {
              client._notifiedAboutPartnerLeave = true;
            }
          } catch (error) {
            console.error("[ChatRoom] Error sending messages to partner:", error);
          }
        } else {
          console.warn(`[ChatRoom] Partner ${client.userId} WebSocket not open, readyState: ${client.readyState}`);
        }
      }
      
      // Cancel any existing cleanup timeout
      if (this.nextCleanupTimeout) {
        clearTimeout(this.nextCleanupTimeout);
      }
      
      // Give enough delay to ensure partner receives both messages before closing connections
      // For browser navigation, we need more time to ensure messages are received
      const cleanupDelay = isBrowserNavigation ? 500 : 100; // 500ms for browser nav, 100ms for Next button
      console.log(`[ChatRoom] Setting cleanup delay of ${cleanupDelay}ms for ${isBrowserNavigation ? 'browser navigation' : 'Next button click'}`);
      
      this.nextCleanupTimeout = setTimeout(() => {
        this.nextCleanupTimeout = null;
        
        // Close ALL WebSocket connections (both the user who clicked Next and their partner)
        console.log(`[ChatRoom] Closing all ${this.clients.size} connection(s)`);
        
        // First, remove and close the user who clicked Next
        if (userId) {
          this.userIds.delete(userId);
          this.userNames.delete(userId);
        }
        this.clients.delete(ws);
        if (ws.readyState === WebSocket.READY_STATE_OPEN || ws.readyState === WebSocket.READY_STATE_CONNECTING) {
          try {
            ws.close(1000, "User clicked Next");
          } catch (error) {
            console.error("[ChatRoom] Error closing user's WebSocket:", error);
          }
        }
        
        // Then close all remaining connections (the partner)
        // Create a copy of clients array to avoid iteration issues
        const remainingClients = Array.from(this.clients);
        for (const client of remainingClients) {
          const partnerUserId = client.userId;
          if (partnerUserId) {
            this.userIds.delete(partnerUserId);
            this.userNames.delete(partnerUserId);
          }
          
          if (client.readyState === WebSocket.READY_STATE_OPEN || client.readyState === WebSocket.READY_STATE_CONNECTING) {
            try {
              // Use different close reason for browser navigation vs Next button
              const closeReason = isBrowserNavigation 
                ? "Room closed - partner left via browser navigation" 
                : "Partner clicked Next - session ended";
              client.close(1000, closeReason);
              console.log(`[ChatRoom] Closed partner ${partnerUserId}'s connection: ${closeReason}`);
            } catch (error) {
              console.error("[ChatRoom] Error closing partner's WebSocket:", error);
            }
          }
        }
        
        // Clear all clients and messages
        this.clients.clear();
        
        // Cleanup immediately - both users are now disconnected
        console.log("[ChatRoom] All clients disconnected after Next, clearing chat data immediately");
        this.cleanup();
      }, cleanupDelay); // Use dynamic delay based on whether it's browser navigation
    } else {
      // Only one client, cleanup immediately
      if (userId) {
        this.userIds.delete(userId);
        this.userNames.delete(userId);
      }
      
      this.clients.delete(ws);
      if (ws.readyState === WebSocket.READY_STATE_OPEN || ws.readyState === WebSocket.READY_STATE_CONNECTING) {
        try {
          ws.close(1000, "User clicked Next");
        } catch (error) {
          console.error("[ChatRoom] Error closing WebSocket:", error);
        }
      }
      
      console.log("[ChatRoom] Only client disconnected, clearing chat data immediately");
      this.cleanup();
    }
  }

  cleanup() {
    console.log("[ChatRoom] Cleaning up chat room - clearing all messages and connections");
    
    // Cancel any pending cleanup timeout
    if (this.nextCleanupTimeout) {
      clearTimeout(this.nextCleanupTimeout);
      this.nextCleanupTimeout = null;
    }
    
    // Close all remaining WebSocket connections
    for (const client of this.clients) {
      if (client.readyState === WebSocket.READY_STATE_OPEN) {
        try {
          client.close(1011, "Room cleaned up");
        } catch (error) {
          console.error("[ChatRoom] Error closing client during cleanup:", error);
        }
      }
    }
    
    // Clear all data
    this.clients.clear();
    this.messages = [];
    this.userIds.clear();
    this.userNames.clear();
    this.lastActivity = Date.now();
    
    console.log("[ChatRoom] Cleanup complete - all messages and connections cleared");
  }

  handleChatMessage(data, ws) {
    if (!data.message || !data.userId || !data.userName) {
      return;
    }

    // Validate message content (basic check)
    if (typeof data.message !== "string" || data.message.trim().length === 0) {
      return;
    }

    const msg = {
      type: "chatMessage",
      userId: data.userId,
      userName: data.userName || this.userNames.get(data.userId) || "Stranger",
      message: data.message.trim(),
      timestamp: data.timestamp || Date.now(),
    };

    // Store message (keep last 20)
    this.messages.push(msg);
    if (this.messages.length > this.messageLimit) {
      this.messages.shift();
    }

    // Broadcast to all clients except sender
    this.broadcast(msg, ws);
    
    console.log(`[ChatRoom] Message from ${data.userId}: ${msg.message.substring(0, 50)}`);
  }

  broadcast(message, excludeWs = null) {
    const messageStr = JSON.stringify(message);
    let sentCount = 0;
    
    for (const client of this.clients) {
      if (client === excludeWs) continue;
      if (client.readyState === WebSocket.READY_STATE_OPEN) {
        try {
          client.send(messageStr);
          sentCount++;
        } catch (error) {
          console.error("[ChatRoom] Broadcast error:", error);
        }
      }
    }
    
    return sentCount;
  }

  handleClose(ws) {
    const userId = ws.userId;
    const userName = this.userNames.get(userId) || "Stranger";
    
    // Remove event listeners if stored
    if (ws._handlers) {
      ws.removeEventListener("message", ws._handlers.messageHandler);
      ws.removeEventListener("close", ws._handlers.closeHandler);
      ws.removeEventListener("error", ws._handlers.errorHandler);
      delete ws._handlers;
    }
    
    this.clients.delete(ws);
    
    console.log(`[ChatRoom] Client disconnected: userId=${userId}, userName=${userName}, remaining=${this.clients.size}`);

    // If this disconnect was already handled via "next" message (user clicked Next),
    // the partner was already notified and connections are being closed intentionally
    // Check if this WebSocket was marked as notified (from handleNext)
    if (ws._notifiedAboutPartnerLeave) {
      console.log(`[ChatRoom] Partner was already notified about ${userId} leaving, skipping grace period`);
      // Just cleanup - partner was already notified
      if (userId) {
        this.userIds.delete(userId);
        this.userNames.delete(userId);
      }
      if (this.clients.size === 0) {
        this.scheduleCleanup();
      }
      return;
    }
    
    // Only notify partner if they haven't already been notified (e.g., via "next" message)
    // Add grace period to avoid false positives from temporary connection issues
    if (userId && this.clients.size > 0 && !this.pendingDisconnects.has(userId)) {
      // Set up grace period before notifying partner
      // This allows time for the user to reconnect if it's a temporary network issue
      const timeoutId = setTimeout(() => {
        // Check if user reconnected (would have canceled this timeout)
        if (!this.userIds.has(userId)) {
          // User didn't reconnect - notify partner
          const message = {
            type: "partner_left",
            userId,
            userName,
            timestamp: Date.now(),
            reason: "Partner disconnected",
            autoRequeue: false, // Manual re-queue for unexpected disconnects
          };
          
          const sentCount = this.broadcast(message);
          console.log(`[ChatRoom] Notified ${sentCount} remaining client(s) about ${userId} leaving after grace period`);
        } else {
          // User reconnected - cancel notification
          console.log(`[ChatRoom] User ${userId} reconnected within grace period, not sending partner_left`);
        }
        
        // Clean up pending disconnect tracking
        this.pendingDisconnects.delete(userId);
        
        // Remove userId from tracking if not reconnected
        if (!this.userIds.has(userId)) {
          this.userIds.delete(userId);
          this.userNames.delete(userId);
        }
      }, this.disconnectGracePeriod);
      
      this.pendingDisconnects.set(userId, timeoutId);
      console.log(`[ChatRoom] Set grace period for ${userId} disconnect notification (${this.disconnectGracePeriod}ms)`);
    } else {
      // No remaining clients or already has pending disconnect - just cleanup
      // Remove from tracking even if no clients remain
      if (userId) {
        this.userIds.delete(userId);
        this.userNames.delete(userId);
      }
    }

    // If no clients remain, schedule cleanup
    if (this.clients.size === 0) {
      console.log("[ChatRoom] All clients disconnected, scheduling cleanup");
      this.scheduleCleanup();
    }
  }

  resetAlarm() {
    if (this.clients.size === 0) {
      // If no clients, schedule immediate cleanup
      this.scheduleCleanup();
      return;
    }

    // Reset alarm for idle timeout
    const alarmTime = Date.now() + this.idleTimeout;
    this.state.storage.setAlarm(alarmTime).catch(console.error);
    this.alarmScheduled = true;
  }

  scheduleCleanup() {
    // Use the cleanup method to ensure consistent behavior
    this.cleanup();
    
    // Schedule cleanup in 30 seconds after last disconnect
    const cleanupDelay = 30000; // 30 seconds
    const alarmTime = Date.now() + cleanupDelay;
    this.state.storage.setAlarm(alarmTime).catch(console.error);
    this.alarmScheduled = true;
  }

  async alarm() {
    // Called by Durable Object alarm system
    const now = Date.now();
    const timeSinceActivity = now - this.lastActivity;
    const hasClients = this.clients.size > 0;

    console.log(`[ChatRoom] Alarm triggered: clients=${this.clients.size}, idle=${timeSinceActivity}ms`);

    // If no clients and enough time has passed, clear ALL chat data
    if (!hasClients || timeSinceActivity >= this.idleTimeout) {
      console.log("[ChatRoom] Clearing all messages and chat data due to inactivity");
      this.messages = [];
      this.userIds.clear();
      this.userNames.clear();
      
      // Close any remaining connections
      for (const client of this.clients) {
        if (client.readyState === WebSocket.READY_STATE_OPEN) {
          try {
            client.send(JSON.stringify({ type: "room_closed", reason: "inactivity" }));
            client.close(1011, "Room inactive");
          } catch (error) {
            console.error("[ChatRoom] Error closing client:", error);
          }
        }
      }
      
      this.clients.clear();
      this.userIds.clear();
      this.userNames.clear();
    } else if (hasClients) {
      // Still have clients, reset alarm for next check
      this.resetAlarm();
    }
  }
}

