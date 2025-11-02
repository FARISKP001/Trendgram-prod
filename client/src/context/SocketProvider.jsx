import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SocketContext } from './SocketContext';

// Console logging optimization - only log in development
const DEBUG = import.meta.env.DEV;
const log = (...args) => DEBUG && console.log(...args);
const logError = (...args) => DEBUG && console.error(...args);
const logWarn = (...args) => DEBUG && console.warn(...args);

// Retrieve or create a persistent user ID for the current client.
const getUserToken = () => {
  let token = localStorage.getItem('userId');
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem('userId', token);
  }
  return token;
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
  const prodUrl = window.location.origin;
  logWarn('[SocketProvider] Production mode, using origin as worker URL (may be incorrect):', prodUrl);
  return prodUrl;
};

const SocketProvider = ({ children }) => {
  const [ws, setWs] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [partnerId, setPartnerId] = useState(null);
  const [partnerName, setPartnerName] = useState(null);

  const userIdRef = useRef(getUserToken());
  const userNameRef = useRef(null);
  const deviceIdRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 10;
  
  // Cleanup reconnect timeout on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, []);

  // Connect to matchmaking and then to chat room
  const connectToMatch = async (userId, userName, deviceId, emotion = null, language = null, mode = null) => {
    try {
      const workerURL = getWorkerURL();
      log('[SocketProvider] Calling matchmaking API:', { userId, userName, emotion, language, mode, workerURL });
      
      const response = await fetch(`${workerURL}/api/match`, {
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
      });

      if (!response.ok) {
        const errorText = await response.text();
        logError('[SocketProvider] Matchmaking API error:', response.status, errorText);
        throw new Error(`Matchmaking failed: ${response.statusText}`);
      }

      const data = await response.json();
      log('[SocketProvider] Matchmaking response:', data);

      if (data.matched && data.sessionId) {
        // Match found! Connect to WebSocket
        // Ensure partnerName has a fallback value
        const partnerName = data.partnerName || 'Stranger';
        
        log('[SocketProvider] ✅ Match found!', { 
          sessionId: data.sessionId, 
          partnerId: data.partnerId, 
          partnerName,
          wsUrl: data.wsUrl 
        });
        
        setSessionId(data.sessionId);
        setPartnerId(data.partnerId);
        setPartnerName(partnerName);
        
        // Trigger partner_found event with original criteria
        // CRITICAL: Ensure all required fields are present
        const eventDetail = {
          partnerId: data.partnerId,
          partnerName: partnerName, // Always provide a value, never null/undefined
          sessionId: data.sessionId,
          emotion: emotion, // Include original criteria
          language: language,
          mode: mode,
        };
        
        log('[SocketProvider] Dispatching partner_found event:', eventDetail);
        
        // Dispatch event synchronously to ensure it's received
        try {
          window.dispatchEvent(new CustomEvent('partner_found', { detail: eventDetail }));
          log('[SocketProvider] ✅ partner_found event dispatched successfully');
        } catch (error) {
          logError('[SocketProvider] Error dispatching partner_found event:', error);
        }
        
        // Connect to WebSocket chat room
        // Build WebSocket URL using worker URL, not frontend URL
        if (data.wsUrl) {
          // Use wsUrl from response if provided
          connectToChat(data.wsUrl, userId, userName);
        } else {
          // Build WebSocket URL manually if not in response
          const protocol = workerURL.startsWith('https') ? 'wss' : 'ws';
          const wsUrlObj = new URL(workerURL);
          const fullWsUrl = `${protocol}://${wsUrlObj.host}/chat?sessionId=${data.sessionId}&userId=${userId}&userName=${encodeURIComponent(userName)}`;
          log('[SocketProvider] Connecting to WebSocket (built URL):', { fullWsUrl, workerURL, host: wsUrlObj.host });
          connectToChat(fullWsUrl, userId, userName);
        }
        
        return data;
      } else {
        // Still waiting, poll again after a delay
        log('[SocketProvider] Still waiting for partner...', data.message);
        return { matched: false, message: data.message || 'Waiting for partner...' };
      }
    } catch (error) {
      logError('[SocketProvider] Matchmaking error:', error);
      throw error;
    }
  };

  // Connect to chat room WebSocket
  const connectToChat = (wsUrl, userId, userName) => {
    try {
      // Close existing connection if any
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      const newWs = new WebSocket(wsUrl);

      newWs.onopen = () => {
        log('[SocketProvider] ✅ WebSocket connected successfully!', { 
          url: wsUrl,
          readyState: newWs.readyState,
          userId,
          userName 
        });
        setIsConnected(true);
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
          
          // Clear existing reconnect timeout before setting new one
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
          }
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            if (sessionId && userIdRef.current && userNameRef.current) {
              const baseWorkerURL = getWorkerURL();
              const protocol = baseWorkerURL.startsWith('https') ? 'wss' : 'ws';
              const wsUrlObj = new URL(baseWorkerURL);
              const wsUrl = `${protocol}://${wsUrlObj.host}/chat?sessionId=${sessionId}&userId=${userIdRef.current}&userName=${encodeURIComponent(userNameRef.current)}`;
              connectToChat(wsUrl, userIdRef.current, userNameRef.current);
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
      const message = JSON.stringify({ type, ...payload });
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
        ws.close();
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
        window.dispatchEvent(new CustomEvent('partner_connected', { detail: data }));
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
            if (ws) ws.close();
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
          window.addEventListener(event, wrappedHandler);
          // Store handler for cleanup
          if (!ws._handlers) ws._handlers = {};
          if (!ws._handlers[event]) ws._handlers[event] = [];
          ws._handlers[event].push({ handler, wrappedHandler });
        },
        off: (event, handler) => {
          // Remove event handler
          if (ws?._handlers?.[event]) {
            const item = ws._handlers[event].find(h => h.handler === handler);
            if (item) {
              window.removeEventListener(event, item.wrappedHandler);
              ws._handlers[event] = ws._handlers[event].filter(h => h !== item);
            }
          }
        },
        disconnect: () => {
          if (ws) ws.close();
        },
        connect: () => {
          // Trigger reconnection
          if (sessionId && userIdRef.current && userNameRef.current) {
            const baseWorkerURL = getWorkerURL();
            const protocol = baseWorkerURL.startsWith('https') ? 'wss' : 'ws';
            const wsUrlObj = new URL(baseWorkerURL);
            const wsUrl = `${protocol}://${wsUrlObj.host}/chat?sessionId=${sessionId}&userId=${userIdRef.current}&userName=${encodeURIComponent(userNameRef.current)}`;
            connectToChat(wsUrl, userIdRef.current, userNameRef.current);
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
