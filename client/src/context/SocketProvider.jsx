import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SocketContext } from './SocketContext';

// Console logging optimization - only log in development
const DEBUG = import.meta.env.DEV;
const log = (...args) => DEBUG && console.log(...args);
const logError = (...args) => DEBUG && console.error(...args);
const logWarn = (...args) => DEBUG && console.warn(...args);

// Retrieve or create a persistent user ID for the current client.
const getUserToken = () => {
  try {
    if (typeof window === 'undefined' || !window?.localStorage) {
      return `srv-${Math.random().toString(36).slice(2, 10)}`;
    }
    let token = window.localStorage.getItem('userId');
    if (!token) {
      const uuid = (typeof crypto !== 'undefined' && crypto?.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      token = uuid;
      window.localStorage.setItem('userId', token);
    }
    return token;
  } catch (_) {
    return `anon-${Math.random().toString(36).slice(2, 10)}`;
  }
};

// Get Worker URL from environment or use current origin
const getWorkerURL = () => {
  // Priority 1: Explicit environment variable
  if (import.meta.env.VITE_WORKER_URL) {
    const url = import.meta.env.VITE_WORKER_URL;
    log('[SocketProvider] Using VITE_WORKER_URL:', url);
    return url;
  }
  // Priority 2: Local dev - always use worker port
  if (import.meta.env.DEV) {
    const devUrl = 'http://localhost:8787';
    log('[SocketProvider] DEV mode, using worker URL:', devUrl);
    return devUrl;
  }
  // Priority 3: Production - use worker URL or fallback to origin
  if (typeof window !== 'undefined' && window?.location?.origin) {
    const prodUrl = window.location.origin;
    logWarn('[SocketProvider] Production mode, using origin as worker URL (may be incorrect):', prodUrl);
    return prodUrl;
  }
  logWarn('[SocketProvider] Production mode in non-window environment, no worker URL available');
  return null;
};

const normalizeBaseURL = (value) => {
  if (!value) return null;
  let normalized = value.trim();
  if (normalized.startsWith('ws://')) {
    normalized = normalized.replace(/^ws:/i, 'http:');
  } else if (normalized.startsWith('wss://')) {
    normalized = normalized.replace(/^wss:/i, 'https:');
  }
  try {
    return new URL(normalized);
  } catch (err) {
    try {
      const fallback = normalized.replace(/^\/*/, '');
      return new URL(`https://${fallback}`);
    } catch (_) {
      return null;
    }
  }
};

const buildWsUrl = (base, roomId, userId, userName, queueKey) => {
  if (!base || !roomId || !userId) return null;
  const urlObj = normalizeBaseURL(base);
  if (!urlObj) return null;
  const protocol = urlObj.protocol === 'https:' ? 'wss:' : 'ws:';
  const encodedName = userName ? `&userName=${encodeURIComponent(userName)}` : '';
  const queueKeyParam = queueKey ? `&queueKey=${encodeURIComponent(queueKey)}` : '';
  return `${protocol}//${urlObj.host}/chat/${roomId}?userId=${encodeURIComponent(userId)}${encodedName}${queueKeyParam}`;
};

const extractRoomId = (wsUrl) => {
  if (!wsUrl) return null;
  try {
    const url = new URL(wsUrl);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.pop() || null;
  } catch (_) {
    return null;
  }
};

const deriveWorkerBase = (value) => {
  const urlObj = normalizeBaseURL(value);
  if (!urlObj) return null;
  return `${urlObj.protocol}//${urlObj.host}`;
};

const noopTelemetry = {
  onMatchStart: () => {},
  onMatchResult: () => {},
  onMatchError: () => {},
  onWsOpen: () => {},
  onWsError: () => {},
  onWsClose: () => {},
  onReconnectScheduled: () => {},
};

const SocketProvider = ({ children, telemetry }) => {
  const [ws, setWs] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [partnerId, setPartnerId] = useState(null);
  const [partnerName, setPartnerName] = useState(null);

  const userIdRef = useRef(getUserToken());
  const userNameRef = useRef(null);
  const deviceIdRef = useRef(null);
  const workerBaseRef = useRef(null);
  const wsUrlRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  const queueKeyRef = useRef(null);
  const handlersRef = useRef({});
  const telemetryRef = useRef(noopTelemetry);
  const matchAbortRef = useRef(null);
  const matchTimeoutRef = useRef(null);

  useEffect(() => {
    telemetryRef.current = telemetry || noopTelemetry;
  }, [telemetry]);
  
  // Cleanup reconnect timeout on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (matchTimeoutRef.current) {
        clearTimeout(matchTimeoutRef.current);
        matchTimeoutRef.current = null;
      }
      if (matchAbortRef.current) {
        try { matchAbortRef.current.abort('component-unmount'); } catch {}
        matchAbortRef.current = null;
      }
      // Remove any globally registered window event handlers
      try {
        const allHandlers = handlersRef.current || {};
        Object.keys(allHandlers).forEach((eventName) => {
          const list = allHandlers[eventName] || [];
          list.forEach((item) => {
            if (item?.wrappedHandler) {
              window.removeEventListener(eventName, item.wrappedHandler);
            }
          });
        });
        handlersRef.current = {};
      } catch (err) {
        logWarn('[SocketProvider] Error cleaning up handlers on unmount', err);
      }
    };
  }, []);

  // Connect to matchmaking and then to chat room
  const connectToMatch = async (userId, userName, deviceId, emotion = null, language = null, mode = null) => {
    try {
      // Persist identity for later reconnect flows
      userIdRef.current = userId || userIdRef.current;
      userNameRef.current = userName || userNameRef.current;

      const workerURL = getWorkerURL();
      const baseUrl = workerURL.replace(/\/$/, '');
      const workerUrlObj = normalizeBaseURL(workerURL);
      const matchUrl = workerUrlObj
        ? new URL('/api/match', workerUrlObj).toString()
        : `${baseUrl}/api/match`;
      log('[SocketProvider] Calling matchmaking API:', { userId, userName, emotion, language, mode, workerURL, matchUrl });

      // Abort any previous in-flight matchmaking request
      if (matchTimeoutRef.current) {
        clearTimeout(matchTimeoutRef.current);
        matchTimeoutRef.current = null;
      }
      if (matchAbortRef.current) {
        try { matchAbortRef.current.abort('new-match-request'); } catch {}
        matchAbortRef.current = null;
      }

      const controller = new AbortController();
      matchAbortRef.current = controller;
      const MATCH_TIMEOUT_MS = 10000;
      const matchStartTs = performance.now();
      telemetryRef.current.onMatchStart?.({ userId, userName, deviceId, emotion, language, mode });
      matchTimeoutRef.current = setTimeout(() => {
        try { controller.abort('matchmaking-timeout'); } catch {}
      }, MATCH_TIMEOUT_MS);

      const response = await fetch(matchUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          userName,
          deviceId,
          emotion,
          language,
          mode,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logError('[SocketProvider] Matchmaking API error:', response.status, errorText);
        throw new Error(`Matchmaking failed: ${response.statusText}`);
      }

      const data = await response.json();
      log('[SocketProvider] Matchmaking response:', data);
      const latencyMs = Math.round(performance.now() - matchStartTs);

      const isMatched = data.status === 'matched' || data.matched;
      const roomId = data.sessionId || data.roomId || extractRoomId(data.wsUrl);

      if (isMatched && (roomId || data.wsUrl)) {
        telemetryRef.current.onMatchResult?.({
          matched: true,
          roomId,
          latencyMs,
        });
        const partnerNameResolved = data.partnerName || 'Stranger';
        const workerFallbackBase = deriveWorkerBase(workerURL);
        const resolvedWorkerBase = data.workerWsBase || deriveWorkerBase(data.wsUrl) || workerFallbackBase;
        const wsUrlToUse =
          data.wsUrl ||
          buildWsUrl(resolvedWorkerBase, roomId, userId, userName, data.queueKey) ||
          buildWsUrl(workerFallbackBase, roomId, userId, userName, data.queueKey);

        log('[SocketProvider] ✅ Match found!', {
          roomId,
          partnerId: data.partnerId,
          partnerName: partnerNameResolved,
          wsUrl: wsUrlToUse,
          queueKey: data.queueKey || null,
          workerWsBase: resolvedWorkerBase,
        });

        setSessionId(roomId || null);
        setPartnerId(data.partnerId);
        setPartnerName(partnerNameResolved);
        workerBaseRef.current = resolvedWorkerBase;
        wsUrlRef.current = wsUrlToUse;

        const eventDetail = {
          partnerId: data.partnerId,
          partnerName: partnerNameResolved,
          sessionId: roomId,
          roomId,
          emotion,
          language,
          mode,
          wsUrl: wsUrlToUse,
          workerWsBase: resolvedWorkerBase,
          queueKey: data.queueKey || null,
        };

        log('[SocketProvider] Dispatching partner_found event:', eventDetail);

        try {
          window.dispatchEvent(new CustomEvent('partner_found', { detail: eventDetail }));
          log('[SocketProvider] ✅ partner_found event dispatched successfully');
        } catch (error) {
          logError('[SocketProvider] Error dispatching partner_found event:', error);
        }

        if (wsUrlToUse) {
          queueKeyRef.current = data.queueKey || null;
          connectToChat(wsUrlToUse, userId, userName, queueKeyRef.current);
        }

        return { ...data, matched: true, roomId, wsUrl: wsUrlToUse, workerWsBase: resolvedWorkerBase };
      } else {
        // Still waiting, poll again after a delay
        log('[SocketProvider] Still waiting for partner...', data.message);
        return { matched: false, message: data.message || 'Waiting for partner...' };
      }
    } catch (error) {
      logError('[SocketProvider] Matchmaking error:', error);
      telemetryRef.current.onMatchError?.({
        error: String(error?.message || error),
        isAbort: error?.name === 'AbortError',
      });
      throw error;
    } finally {
      if (matchTimeoutRef.current) {
        clearTimeout(matchTimeoutRef.current);
        matchTimeoutRef.current = null;
      }
      if (matchAbortRef.current) {
        // keep controller if caller might read it; otherwise clear
        matchAbortRef.current = null;
      }
    }
  };

  // Connect to chat room WebSocket
  const connectToChat = (wsUrl, userId, userName, queueKey = null) => {
    try {
      log('[SocketProvider] connectToChat called', { wsUrl, userId, userName, queueKey, hasExistingWs: !!ws });
      
      // Close existing connection if any
      if (ws && ws.readyState === WebSocket.OPEN) {
        log('[SocketProvider] Closing existing WebSocket connection');
        ws.close(1000, 'Reconnecting');
      }

      if (queueKey) {
        queueKeyRef.current = queueKey;
      }

      // Ensure user identity is persisted for reconnects
      userIdRef.current = userId || userIdRef.current;
      userNameRef.current = userName || userNameRef.current;

      if (!wsUrl) {
        const effectiveQueueKey = queueKey ?? queueKeyRef.current ?? null;
        wsUrl = wsUrlRef.current
          || buildWsUrl(workerBaseRef.current || getWorkerURL(), sessionId, userId, userName, effectiveQueueKey);
        log('[SocketProvider] Built WebSocket URL:', wsUrl);
      }
      if (!wsUrl) {
        logError('[SocketProvider] Missing WebSocket URL for chat connection', { sessionId, userId, userName, queueKey });
        throw new Error('Missing WebSocket URL for chat connection');
      }

      log('[SocketProvider] Creating new WebSocket connection', { wsUrl, userId, userName });
      const newWs = new WebSocket(wsUrl);
      wsUrlRef.current = wsUrl;

      newWs.onopen = () => {
        log('[SocketProvider] ✅ WebSocket connected successfully!', { 
          url: wsUrl,
          readyState: newWs.readyState,
          userId,
          userName 
        });
        setIsConnected(true);
        const attempt = reconnectAttemptsRef.current;
        telemetryRef.current.onWsOpen?.({
          wsUrl,
          attempt,
        });
        reconnectAttemptsRef.current = 0;

        // Send initial connection message
        try {
          newWs.send(JSON.stringify({
            type: 'partner_found',
            userId,
            userName,
          }));
          log('[SocketProvider] Initial connection message sent');
        } catch (error) {
          logError('[SocketProvider] Error sending initial message:', error);
        }
      };

      newWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          log('[SocketProvider] 📨 Message received:', data);
          handleMessage(data, newWs);
        } catch (error) {
          logError('[SocketProvider] Message parse error:', error, event.data);
        }
      };

      newWs.onerror = (error) => {
        logError('[SocketProvider] 🔴 WebSocket error:', error);
        logError('[SocketProvider] WebSocket error details:', { 
          readyState: newWs.readyState,
          url: wsUrl 
        });
        telemetryRef.current.onWsError?.({
          wsUrl,
          error: String(error?.message || error),
        });
      };

      newWs.onclose = (event) => {
        log('[SocketProvider] ⚠️ WebSocket closed:', { 
          code: event.code, 
          reason: event.reason,
          wasClean: event.wasClean,
          url: wsUrl,
          userId: userIdRef.current
        });
        setIsConnected(false);
        telemetryRef.current.onWsClose?.({
          wsUrl,
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });

        // Check if this is a room_closed scenario (browser navigation)
        const reason = event.reason || '';
        const isRoomClosed = reason.includes('Room closed') || reason.includes('room closed');
        
        if (isRoomClosed) {
          log('[SocketProvider] WebSocket closed - room closed (browser navigation), triggering room_closed event', { reason, code: event.code });
          window.dispatchEvent(new CustomEvent('room_closed', { 
            detail: {
              reason: reason || 'Room closed',
              timestamp: Date.now(),
            }
          }));
          reconnectAttemptsRef.current = 0; // Reset reconnect attempts
          return;
        }
        
        // If closed with reason "Partner clicked Next" or "session ended", trigger partner_left event
        // This handles the case where the WebSocket closes before the partner_left message is received
        // BUT: Only trigger if it's NOT the current user who clicked Next (check reason doesn't say "User clicked Next")
        const isPartnerClickingNext = reason.includes('Partner clicked Next') || reason.includes('session ended');
        const isOurOwnNext = reason.includes('User clicked Next') || reason.includes('User left') || reason.includes('User clicked Next');
        
        if (isPartnerClickingNext && !isOurOwnNext) {
          log('[SocketProvider] WebSocket closed due to partner clicking Next, triggering partner_left event', { reason, code: event.code });
          window.dispatchEvent(new CustomEvent('partner_left', { 
            detail: {
              userId: null, // Unknown userId, but we know partner left
              userName: 'Partner',
              timestamp: Date.now(),
              reason: 'Partner clicked Next',
              autoRequeue: true // Auto-requeue when partner closes connection
            }
          }));
          reconnectAttemptsRef.current = 0; // Reset reconnect attempts
          return;
        }
        
        // If closed with reason "User clicked Next", this is our own Next click - don't trigger partner_left
        if (isOurOwnNext) {
          log('[SocketProvider] WebSocket closed due to our own Next click, not triggering partner_left or reconnecting', { reason, code: event.code });
          reconnectAttemptsRef.current = 0; // Reset reconnect attempts
          return;
        }

        // Don't auto-reconnect if user intentionally closed (code 1000 = normal closure)
        // This happens when user clicks Next button or navigates away
        if (event.code === 1000 && event.reason && (event.reason.includes('User clicked Next') || event.reason.includes('User left'))) {
          log('[SocketProvider] WebSocket closed intentionally (user clicked Next or left), not reconnecting');
          reconnectAttemptsRef.current = 0; // Reset reconnect attempts
          return;
        }
        
        // Don't reconnect for code 1006 (abnormal closure) - session is ending (likely after Next click)
        // Code 1006 usually means the connection closed abnormally, often after we initiated a close
        if (event.code === 1006) {
          log('[SocketProvider] WebSocket closed abnormally (code 1006) - likely session ended after Next click, not reconnecting');
          reconnectAttemptsRef.current = 0; // Reset reconnect attempts
          return;
        }

        // Auto-reconnect if not a normal closure and not intentional
        if (event.code !== 1000 && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          log(`[SocketProvider] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          telemetryRef.current.onReconnectScheduled?.({
            attempt: reconnectAttemptsRef.current,
            delayMs: delay,
            wsUrl,
          });
          
          // Clear existing reconnect timeout before setting new one
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            if (userIdRef.current && userNameRef.current) {
              const fallbackBase = workerBaseRef.current || getWorkerURL();
              const wsUrlNext = wsUrlRef.current
                || buildWsUrl(fallbackBase, sessionId, userIdRef.current, userNameRef.current, queueKeyRef.current);
              if (wsUrlNext) {
                connectToChat(wsUrlNext, userIdRef.current, userNameRef.current, queueKeyRef.current);
              }
            }
          }, delay);
        }
      };

      setWs(newWs);
    } catch (error) {
      logError('[SocketProvider] WebSocket connection error:', error);
      setIsConnected(false);
    }
  };

  // Handle incoming messages and dispatch events
  const handleMessage = (data, ws) => {
    // Create custom events for compatibility with existing code
    const event = new CustomEvent('wsmessage', { detail: data });
    window.dispatchEvent(event);
  };

  // Send message via WebSocket
  const sendMessage = (type, payload) => {
    log('[SocketProvider] sendMessage called', { type, payload, wsReadyState: ws?.readyState, hasWs: !!ws });
    if (ws && ws.readyState === WebSocket.OPEN) {
      const { type: _ignored, ...rest } = payload || {};
      const message = JSON.stringify({ type, ...rest });
      log('[SocketProvider] Sending message:', message);
      ws.send(message);
      log('[SocketProvider] ✅ Message sent successfully');
    } else {
      logWarn('[SocketProvider] ⚠️ WebSocket not connected', { 
        hasWs: !!ws, 
        readyState: ws?.readyState,
        readyStateText: ws?.readyState === WebSocket.OPEN ? 'OPEN' : 
                        ws?.readyState === WebSocket.CONNECTING ? 'CONNECTING' :
                        ws?.readyState === WebSocket.CLOSING ? 'CLOSING' :
                        ws?.readyState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN'
      });
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (ws && ws.readyState !== WebSocket.CLOSED) {
        ws.close(1000, 'Provider unmount');
      }
    };
  }, [ws]);

  // Listen for custom events (for compatibility with Socket.io style API)
  useEffect(() => {
    const handleWsMessage = (event) => {
      const data = event.detail;
      // Handle different message types
      if (data.type === 'chatMessage') {
        window.dispatchEvent(new CustomEvent('chatMessage', { detail: data }));
      } else if (data.type === 'partner_left') {
        // Ensure partner_left event is dispatched with proper detail structure
        // Include autoRequeue flag if present (signals automatic re-queuing)
        window.dispatchEvent(new CustomEvent('partner_left', { 
          detail: {
            userId: data.userId,
            userName: data.userName,
            timestamp: data.timestamp,
            reason: data.reason || 'Partner left',
            autoRequeue: data.autoRequeue || false
          }
        }));
      } else if (data.type === 'partner_connected') {
        const detail = { ...data, sessionId };
        try {
          sessionStorage.setItem('pendingPartnerConnected', JSON.stringify({
            partnerId: detail.userId,
            partnerName: detail.userName,
            sessionId: detail.sessionId || null,
            timestamp: Date.now(),
          }));
        } catch (err) {
          logWarn('[SocketProvider] Unable to persist pending partner_connected event', err);
        }
        window.dispatchEvent(new CustomEvent('partner_connected', { detail }));
      } else if (data.type === 'partner_info') {
        // Partner info received - partner exists but hasn't connected yet
        // Treat this similarly to partner_connected so UI can show partner name
        const detail = { ...data, sessionId };
        log('[SocketProvider] Partner info received:', detail);
        window.dispatchEvent(new CustomEvent('partner_connected', { detail }));
      } else if (data.type === 'room_closed') {
        window.dispatchEvent(new CustomEvent('room_closed', { detail: data }));
      }
    };

    window.addEventListener('wsmessage', handleWsMessage);
    return () => window.removeEventListener('wsmessage', handleWsMessage);
  }, []);

  const value = useMemo(
    () => ({
      // WebSocket instance
      ws,
      isConnected,
      sessionId,
      partnerId,
      partnerName,

      // Socket.io-compatible API for easier migration
      socket: {
        connected: isConnected,
        id: sessionId,
        ws: ws, // Expose WebSocket instance
        emit: (event, data) => {
          // Map Socket.io events to WebSocket messages
          if (event === 'chatMessage') {
            sendMessage('chatMessage', data);
          } else if (event === 'heartbeat') {
            sendMessage('heartbeat', data);
          } else if (event === 'user_idle') {
            sendMessage('user_idle', data);
          } else if (event === 'leave_chat') {
            // Close WebSocket with code 1000 (normal closure) - browser only accepts 1000 or 3000-4999
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
              ws.close(1000, 'User left chat');
            }
          } else if (event === 'register_user') {
            // Store user context, no need to send via WebSocket
            userIdRef.current = data.userId;
            userNameRef.current = data.userName;
            deviceIdRef.current = data.deviceId;
          } else if (event === 'select_mood') {
            // Mood selection - stored for matchmaking, no WebSocket action needed
            // Mood will be passed when calling connectToMatch()
            log('[SocketProvider] Mood selected:', data.mood);
          } else if (event === 'find_new_buddy') {
            // Legacy event - redirect to matchmaking API
            if (data.userId && data.userName && data.deviceId) {
              connectToMatch(data.userId, data.userName, data.deviceId, data.emotion, data.language, data.mode)
                .catch(err => logError('[SocketProvider] Matchmaking error:', err));
            }
          } else if (event === 'next') {
            // Legacy event - close current connection and find new buddy
            if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
              ws.close(1000, 'User clicked Next');
            }
            if (data.userId && data.userName && data.deviceId) {
              connectToMatch(data.userId, data.userName, data.deviceId, null, null, null)
                .catch(err => logError('[SocketProvider] Matchmaking error:', err));
            }
          } else {
            logWarn('[SocketProvider] Unhandled emit event:', event);
          }
        },
        on: (event, handler) => {
          // Register event handler
          const wrappedHandler = (e) => handler(e.detail);
          if (typeof window !== 'undefined') {
            window.addEventListener(event, wrappedHandler);
          }
          // Store handler for cleanup independent of WebSocket instance
          if (!handlersRef.current[event]) handlersRef.current[event] = [];
          handlersRef.current[event].push({ handler, wrappedHandler });
          // Return unsubscribe function to allow easy cleanup by callers
          return () => {
            const list = handlersRef.current[event] || [];
            const item = list.find(h => h.handler === handler);
            if (item) {
              if (typeof window !== 'undefined') {
                window.removeEventListener(event, item.wrappedHandler);
              }
              handlersRef.current[event] = list.filter(h => h !== item);
            }
          };
        },
        off: (event, handler) => {
          // Remove event handler
          const list = handlersRef.current[event];
          if (!list) return;
          const item = list.find(h => h.handler === handler);
          if (item) {
            if (typeof window !== 'undefined') {
              window.removeEventListener(event, item.wrappedHandler);
            }
            handlersRef.current[event] = list.filter(h => h !== item);
          }
        },
        disconnect: () => {
          if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
            ws.close(1000, 'Manual disconnect');
          }
        },
        connect: () => {
          // Trigger reconnection
          if (userIdRef.current && userNameRef.current) {
            const wsUrlNext = wsUrlRef.current
              || buildWsUrl(workerBaseRef.current || getWorkerURL(), sessionId, userIdRef.current, userNameRef.current, queueKeyRef.current);
            if (wsUrlNext) {
              connectToChat(wsUrlNext, userIdRef.current, userNameRef.current, queueKeyRef.current);
            }
          }
        },
        connectToChat: connectToChat, // Expose connectToChat method
      },

      // Direct WebSocket methods
      connectToMatch,
      connectToChat,
      sendMessage,

      // Context setters
      setUserContext: ({ userName, deviceId }) => {
        userNameRef.current = userName;
        deviceIdRef.current = deviceId;
      },
    }),
    [ws, isConnected, sessionId, partnerId, partnerName]
  );

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export default SocketProvider;
