import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import useSocketContext from '../context/useSocketContext';
import joinSound from '../assets/join.mp3';
import leaveSound from '../assets/leave.mp3';
import { FixedSizeList as List } from 'react-window';
import useExitProtection from '../hooks/useExitProtection';
import useChatAnalytics from '../hooks/useChatAnalytics';
import showConfirmToast from '../utils/showConfirmToast';
import { sanitizeMessage, validateText } from '../utils/textFilters';
import SpeechBubble from './SpeechBubble';
import ChatInput from './ChatInput';
import ChatFooter from './ChatFooter';
import useKeyboardVisible from '../hooks/useKeyboardVisible';

const showMobileExitToast = (onConfirm) => {
  showConfirmToast({
    message: "⚠️ You're about to leave the chat.\nDo you want to exit?",
    onConfirm,
    toastId: 'mobile-exit-confirm',
  });
};

const ChatBox = () => {
  const { socket, isConnected, setUserContext, connectToChat: connectToChatFromContext, connectToMatch } = useSocketContext();
  const location = useLocation();
  const navigate = useNavigate();
  const leftManually = useRef(false);
  const [deviceId, setDeviceId] = useState(null);
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');
  const [partnerId, setPartnerId] = useState(null);
  const [partnerName, setPartnerName] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatState, setChatState] = useState('idle');
  const [inputError, setInputError] = useState('');
  const [theme, setTheme] = useState('light');
  const [nextButtonDisabled, setNextButtonDisabled] = useState(false);
  const [canClickNext, setCanClickNext] = useState(true);
  const searchTimeout = useRef(null);
  const matchmakingPollRef = useRef(null); // Track polling intervals to prevent leaks
  const messageListRef = useRef(null);
  const listContainerRef = useRef(null);
  const [listHeight, setListHeight] = useState(0);
  const inputRef = useRef(null);
  const hasHandledLeave = useRef(false);
  const initialMatchRequested = useRef(false);
  const userIdRef = useRef(null);
  const partnerIdRef = useRef(null);
  const idleTimer = useRef(null);
  const isIdle = useRef(false);
  const keyboardVisible = useKeyboardVisible();
  const chatStartTime = useRef(null);
  const nextButtonClickedRef = useRef(false);
  const isMountedRef = useRef(true); // Track mount status to prevent state updates after unmount
  // Store original matchmaking criteria to reuse when clicking Next
  const originalEmotionRef = useRef(null);
  const originalLanguageRef = useRef(null);
  const originalModeRef = useRef(null);
  // Audio refs for memory management
  const joinAudioRef = useRef(null);
  const leaveAudioRef = useRef(null);
  const messageIdsRef = useRef(new Set());
  const messageCounterRef = useRef(0);
  const partnerConnectionTimeoutRef = useRef(null); // Timeout for waiting for partner to connect

  // Load theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || savedTheme === 'light') {
      setTheme(savedTheme);
    }
  }, []);

  // Save theme to localStorage and update document body class
  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Toggle theme handler
  const toggleTheme = () => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  };

  const {
    trackSessionStart,
    trackMessageSent,
    trackSessionEnd,
    trackUserReported,
  } = useChatAnalytics({ userId, partnerId, userName, messages });

  useEffect(() => {
    const init = async () => {
      const FingerprintJS = await import('@fingerprintjs/fingerprintjs');
      const fp = await FingerprintJS.load();
      const result = await fp.get();
      setDeviceId(result.visitorId);
    };
    init();
  }, []);

  useEffect(() => {
    const idFromState = location.state?.userId;
    const nameFromState = location.state?.userName;
    const storedId = sessionStorage.getItem('userId');
    const storedName = sessionStorage.getItem('userName');
    const finalId = idFromState || storedId;
    const finalName = nameFromState || storedName;
    if (!finalId || !finalName) return navigate('/', { replace: true });
    setUserId(finalId);
    setUserName(finalName);
    // Update socket context with userName and deviceId for re-registration on reconnect
    if (socket && finalName && deviceId) {
      setUserContext({ userName: finalName, deviceId });
    }
  }, [location.state, navigate, socket, deviceId]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { partnerIdRef.current = partnerId; }, [partnerId]);

  // Initialize audio objects once and reuse them
  useEffect(() => {
    joinAudioRef.current = new Audio(joinSound);
    leaveAudioRef.current = new Audio(leaveSound);
    return () => {
      if (joinAudioRef.current) {
        joinAudioRef.current.pause();
        joinAudioRef.current.src = '';
        joinAudioRef.current = null;
      }
      if (leaveAudioRef.current) {
        leaveAudioRef.current.pause();
        leaveAudioRef.current.src = '';
        leaveAudioRef.current = null;
      }
    };
  }, []);

  const playSound = (type) => {
    const audio = type === 'join' ? joinAudioRef.current : leaveAudioRef.current;
    if (audio) {
      audio.currentTime = 0; // Reset to start
      audio.play().catch(e => console.error('Audio play failed:', e));
    }
  };

  // Register user (always send userName)
  const registerUser = () => {
    if (!socket?.connected || !userId || !deviceId) return;
    socket.emit('register_user', { userId, deviceId, userName });
    sessionStorage.setItem('userId', userId);
    sessionStorage.setItem('userName', userName);
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInput(val);
    const validation = validateText(val);
    if (!validation.valid) {
      if (validation.reason === 'profanity_not_allowed') setInputError('Profanity is not allowed.');
      else if (validation.reason === 'url_not_allowed') setInputError('Links are not allowed.');
      else if (validation.reason === 'invalid_language') setInputError('Invalid characters detected.');
      else setInputError('Message contains invalid content.');
    } else {
      setInputError('');
    }
  };

  const handleSend = () => {
    console.log('🔵 [ChatBox] handleSend called', { input, chatState, partnerId, hasSocket: !!socket });
    if (!input.trim() || chatState !== 'chatting' || !partnerId) {
      console.warn('🔴 [ChatBox] Cannot send:', { input: !!input.trim(), chatState, partnerId: !!partnerId });
      return;
    }
    const validation = validateText(input);
    if (!validation.valid) {
      console.warn('🔴 [ChatBox] Validation failed:', validation);
      toast.error('Message contains invalid content.');
      return;
    }
    const sanitized = sanitizeMessage(input);
    const timestamp = Date.now();
    
    // Create message object for immediate display
    const messageObj = {
      userId,
      userName,
      message: sanitized,
      timestamp,
    };
    
    console.log('🟢 [ChatBox] Sending message via socket.emit', {
      sanitized,
      userId,
      userName,
      partnerId,
      hasEmit: !!(socket && socket.emit)
    });
    
    // Add message to local state immediately for instant feedback
    setMessages((msgs) => {
      // Create unique message ID for O(1) deduplication
      const msgId = `${timestamp}_${userId}_${++messageCounterRef.current}`;
      
      // O(1) lookup instead of O(n) array search
      if (messageIdsRef.current.has(msgId)) {
        return msgs;
      }
      
      messageIdsRef.current.add(msgId);
      
      // Limit to last 100 messages for performance
      const newMsgs = [...msgs, messageObj];
      if (newMsgs.length > 100) {
        const removed = newMsgs.shift();
        // Remove oldest message ID from set
        const removedIds = Array.from(messageIdsRef.current).filter(id => id.startsWith(`${removed.timestamp}_${removed.userId}_`));
        removedIds.forEach(id => messageIdsRef.current.delete(id));
      }
      return newMsgs;
    });
    
    // Send via WebSocket
    if (socket && socket.emit) {
      socket.emit('chatMessage', {
        userId,
        userName,
        partnerId,
        message: sanitized,
        timestamp,
      });
      console.log('✅ [ChatBox] Message emitted');
    } else {
      console.error('🔴 [ChatBox] Socket not available or emit not found', { socket, hasEmit: !!(socket && socket.emit) });
    }
    
    trackMessageSent(sanitized);
    setInput('');
  };

  const notifyNoBuddy = () => {
    setMessages([{ text: "Please try again...", from: 'system' }]);
    setChatState('noBuddy');
    setNextButtonDisabled(false); // Re-enable Next button after timeout
    nextButtonClickedRef.current = false; // Reset for next attempt
    console.log('⏰ [ChatBox] Search timeout reached, Next button re-enabled');
  };

  const handleNext = async () => {
    // Prevent multiple clicks - if already clicked or disabled, don't allow
    if (nextButtonDisabled || nextButtonClickedRef.current) {
      console.log('⚠️ [ChatBox] Next button already clicked or disabled');
      return;
    }
    
    if (chatState === 'searching') {
      console.log('⚠️ [ChatBox] Already searching, cannot click Next');
      return;
    }
    
    if (!socket) {
      toast.error('Unable to connect to server. Please refresh.');
      return;
    }

    // Mark Next button as clicked and disable it IMMEDIATELY to prevent abuse
    nextButtonClickedRef.current = true;
    setNextButtonDisabled(true);
    
    // IMPORTANT: Set flag IMMEDIATELY and SYNCHRONOUSLY before any async operations
    // This ensures partner_left handler knows WE clicked Next (not the partner)
    leftManually.current = true;

    console.log('🔵 [ChatBox] Next button clicked by user', { 
      userId, 
      leftManually: leftManually.current,
      chatState,
      hasPartner: !!partnerId 
    });

    // Clear ALL previous messages and chat data when leaving
    // Only show this message to the user who clicked Next (not the partner)
    setMessages([{ text: 'You have left the chat, wait for the new partner', from: 'system' }]);
    setChatState('searching');
    setPartnerId(null);
    setPartnerName('');
    sessionStorage.removeItem('partnerId');
    sessionStorage.removeItem('partnerName');
    trackSessionEnd();
    
    // Mark that we've handled our own leave - this prevents us from processing partner_left events
    hasHandledLeave.current = true;
    
    // Send "next" message via WebSocket BEFORE closing to notify partner immediately
    if (socket && socket.ws && socket.ws.readyState === WebSocket.OPEN) {
      try {
        console.log('🔵 [ChatBox] Sending "next" message to server to notify partner');
        socket.ws.send(JSON.stringify({ type: 'next', userId, timestamp: Date.now() }));
        console.log('✅ [ChatBox] "next" message sent');
      } catch (error) {
        console.error('🔴 [ChatBox] Error sending "next" message:', error);
      }
    }
    
    // Use setTimeout to ensure state updates and message sending are processed before closing WebSocket
    // This prevents race conditions with partner_left event
    setTimeout(() => {
      // Close existing WebSocket if connected - server will also handle cleanup
      if (socket && socket.ws) {
        const readyState = socket.ws.readyState;
        console.log('🔵 [ChatBox] Attempting to close WebSocket connection', { 
          userId,
          leftManually: leftManually.current,
          readyState,
          readyStateText: readyState === WebSocket.OPEN ? 'OPEN' : 
                         readyState === WebSocket.CONNECTING ? 'CONNECTING' :
                         readyState === WebSocket.CLOSING ? 'CLOSING' :
                         readyState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN'
        });
        
        if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) {
          // Close with code 1000 (normal closure) - browser only accepts 1000 or 3000-4999
          socket.ws.close(1000, 'User clicked Next');
          console.log('✅ [ChatBox] WebSocket close() called');
        }
      }
    }, 100); // Small delay to ensure message is sent and state is updated
    
    // Get original matchmaking criteria from refs or sessionStorage
    const emotion = originalEmotionRef.current || sessionStorage.getItem('originalEmotion') || null;
    const language = originalLanguageRef.current || sessionStorage.getItem('originalLanguage') || null;
    const storedMode = originalModeRef.current !== null ? originalModeRef.current : (sessionStorage.getItem('originalMode') || null);
    const mode = storedMode === 'null' ? null : storedMode;
    
    console.log('🟢 [ChatBox] Re-entering queue with original criteria:', { emotion, language, mode });
    
    // Start new matchmaking with ORIGINAL criteria (emotion, language, mode)
    // Use setTimeout to ensure WebSocket close completes first
    setTimeout(async () => {
      // Reset leftManually flag after a short delay to allow any pending partner_left events to be ignored
      setTimeout(() => {
        if (isMountedRef.current) {
          leftManually.current = false;
          console.log('🟢 [ChatBox] Reset leftManually flag after Next click handling');
        }
      }, 500);
      
      // Use connectToMatch directly from context
      if (connectToMatch && typeof connectToMatch === 'function') {
        try {
          console.log('🟢 [ChatBox] Starting new matchmaking with original criteria...', { emotion, language, mode });
          
          // Make first matchmaking call
          const firstResult = await connectToMatch(userId, userName, deviceId, emotion, language, mode);
          
          // If matched immediately, partner_found event will handle it
          if (firstResult && firstResult.matched) {
            console.log('✅ [ChatBox] Immediate match found after Next click');
            hasHandledLeave.current = true;
            return;
          }
          
          // Clear any existing polling interval before starting new one
          if (matchmakingPollRef.current) {
            clearInterval(matchmakingPollRef.current);
            matchmakingPollRef.current = null;
          }
          
          // Set up polling for matchmaking (poll every 2 seconds)
          let pollCount = 0;
          const maxPolls = 30; // 60 seconds total (30 * 2 seconds)
          
          matchmakingPollRef.current = setInterval(async () => {
            // Check if component is still mounted
            if (!isMountedRef.current) {
              if (matchmakingPollRef.current) {
                clearInterval(matchmakingPollRef.current);
                matchmakingPollRef.current = null;
              }
              return;
            }
            
            pollCount++;
            console.log(`🟡 [ChatBox] Polling for match (attempt ${pollCount}/${maxPolls})`);
            
            try {
              const result = await connectToMatch(userId, userName, deviceId, emotion, language, mode);
              if (result && result.matched) {
                console.log('✅ [ChatBox] Match found during polling after Next click');
                if (matchmakingPollRef.current) {
                  clearInterval(matchmakingPollRef.current);
                  matchmakingPollRef.current = null;
                }
                hasHandledLeave.current = true;
                // partner_found event will handle navigation
              } else if (pollCount >= maxPolls) {
                console.log('⏰ [ChatBox] Max polls reached after Next click');
                if (matchmakingPollRef.current) {
                  clearInterval(matchmakingPollRef.current);
                  matchmakingPollRef.current = null;
                }
                if (isMountedRef.current) {
                  notifyNoBuddy();
                  setNextButtonDisabled(false);
                  nextButtonClickedRef.current = false;
                  leftManually.current = false;
                }
              }
            } catch (error) {
              console.error('🔴 [ChatBox] Polling error after Next click:', error);
              if (matchmakingPollRef.current) {
                clearInterval(matchmakingPollRef.current);
                matchmakingPollRef.current = null;
              }
              if (isMountedRef.current) {
                notifyNoBuddy();
                setNextButtonDisabled(false);
                nextButtonClickedRef.current = false;
                leftManually.current = false;
              }
            }
          }, 2000); // Poll every 2 seconds
          
          // Store interval ref for cleanup
          hasHandledLeave.current = true;
          
          // Set 60 second timeout - maximum search time
          if (searchTimeout.current) {
            clearTimeout(searchTimeout.current);
          }
          searchTimeout.current = setTimeout(() => {
            if (matchmakingPollRef.current) {
              clearInterval(matchmakingPollRef.current);
              matchmakingPollRef.current = null;
            }
            if (isMountedRef.current) {
              console.log('⏰ [ChatBox] Search timeout (60s) reached');
              notifyNoBuddy();
              setNextButtonDisabled(false);
              nextButtonClickedRef.current = false;
              leftManually.current = false;
            }
          }, 60000); // 60 seconds - maximum one minute
        } catch (error) {
          console.error('🔴 [ChatBox] Matchmaking error:', error);
          toast.error('Failed to find new partner');
          setNextButtonDisabled(false); // Re-enable on error
          nextButtonClickedRef.current = false;
          leftManually.current = false; // Reset on error
          return; // Don't set timeout if matchmaking failed
        }
      }
    }, 100); // Small delay to ensure WebSocket close completes
  };

  const handleNewBuddy = async () => {
    if (chatState === 'chatting' || partnerId || !deviceId) return;
    if (!socket) return toast.error('Unable to connect to server.');
    
    hasHandledLeave.current = false;
    setChatState('searching');
    setPartnerId(null);
    // Clear all messages when starting new search
    setMessages([]);
    sessionStorage.removeItem('partnerId');
    sessionStorage.removeItem('partnerName');
    setNextButtonDisabled(false); // Enable Next button for search
    setCanClickNext(true);
    nextButtonClickedRef.current = false;
    
    // Get original matchmaking criteria from refs or sessionStorage
    const emotion = originalEmotionRef.current || sessionStorage.getItem('originalEmotion') || null;
    const language = originalLanguageRef.current || sessionStorage.getItem('originalLanguage') || null;
    const storedMode = originalModeRef.current !== null ? originalModeRef.current : (sessionStorage.getItem('originalMode') || null);
    const mode = storedMode === 'null' ? null : storedMode;
    
    // Use matchmaking API with polling
    if (connectToMatch) {
      try {
        // Make first matchmaking call
        const firstResult = await connectToMatch(userId, userName, deviceId, emotion, language, mode);
        
        // If matched immediately, partner_found event will handle it
        if (firstResult && firstResult.matched) {
          console.log('✅ [ChatBox] Immediate match found in handleNewBuddy');
          return;
        }
        
        // Clear any existing polling interval before starting new one
        if (matchmakingPollRef.current) {
          clearInterval(matchmakingPollRef.current);
          matchmakingPollRef.current = null;
        }
        
        // Set up polling for matchmaking (poll every 2 seconds)
        let pollCount = 0;
        const maxPolls = 30; // 60 seconds total (30 * 2 seconds)
        
        matchmakingPollRef.current = setInterval(async () => {
          // Check if component is still mounted
          if (!isMountedRef.current) {
            if (matchmakingPollRef.current) {
              clearInterval(matchmakingPollRef.current);
              matchmakingPollRef.current = null;
            }
            return;
          }
          
          // Check if we already have a partner (matched via partner_found event)
          // Use refs and sessionStorage to get current values (avoid stale closure)
          const currentPartnerId = partnerIdRef.current;
          const hasPartnerInStorage = !!sessionStorage.getItem('partnerId');
          const hasSessionIdInStorage = !!sessionStorage.getItem('sessionId') || !!location.state?.sessionId;
          
          // If we have partner info in storage/state or ref, stop polling
          // partner_found event sets these values before navigation
          if (currentPartnerId || hasPartnerInStorage || hasSessionIdInStorage) {
            console.log('✅ [ChatBox] Match found via partner_found event, stopping polling', {
              currentPartnerId,
              hasPartnerInStorage,
              hasSessionIdInStorage
            });
            if (matchmakingPollRef.current) {
              clearInterval(matchmakingPollRef.current);
              matchmakingPollRef.current = null;
            }
            return;
          }
          
          pollCount++;
          console.log(`🟡 [ChatBox] Polling for match in handleNewBuddy (attempt ${pollCount}/${maxPolls})`);
          
          try {
            const result = await connectToMatch(userId, userName, deviceId, emotion, language, mode);
            if (result && result.matched) {
              console.log('✅ [ChatBox] Match found during polling in handleNewBuddy');
              if (matchmakingPollRef.current) {
                clearInterval(matchmakingPollRef.current);
                matchmakingPollRef.current = null;
              }
              // partner_found event will handle navigation
            } else if (pollCount >= maxPolls) {
              console.log('⏰ [ChatBox] Max polls reached in handleNewBuddy');
              if (matchmakingPollRef.current) {
                clearInterval(matchmakingPollRef.current);
                matchmakingPollRef.current = null;
              }
              if (isMountedRef.current) {
                notifyNoBuddy();
              }
            }
          } catch (error) {
            console.error('🔴 [ChatBox] Polling error in handleNewBuddy:', error);
            if (matchmakingPollRef.current) {
              clearInterval(matchmakingPollRef.current);
              matchmakingPollRef.current = null;
            }
            if (isMountedRef.current) {
              notifyNoBuddy();
            }
          }
        }, 2000); // Poll every 2 seconds
      } catch (error) {
        console.error('🔴 [ChatBox] Matchmaking error in handleNewBuddy:', error);
        toast.error('Failed to start matchmaking');
        setChatState('idle');
      }
    }
    
    // Clear any existing timeout
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }
    
    // Set 60 second timeout
    searchTimeout.current = setTimeout(() => {
      if (matchmakingPollRef.current) {
        clearInterval(matchmakingPollRef.current);
        matchmakingPollRef.current = null;
      }
      if (isMountedRef.current) {
        notifyNoBuddy();
      }
    }, 60000);
  };

  const handleReport = () => {
    if (!socket || !partnerId || !deviceId) return;
    const lastMessages = messages.slice(-10);
    socket.emit('report_user', {
      reporterId: userId,
      reporterDeviceId: deviceId,
      reportedUserId: partnerId,
      messages: lastMessages,
    });
    trackUserReported();
  };

  // Initialize chat session from location state or connect to existing session
  useEffect(() => {
    if (!userId || !deviceId) return;
    
    const partnerIdFromState = location.state?.partnerId;
    const partnerNameFromState = location.state?.partnerName;
    const sessionIdFromState = location.state?.sessionId;
    
    if (partnerIdFromState && sessionIdFromState) {
      // We have a matched partner, connect to WebSocket
      // Clear all previous messages and reset state for new session
      setMessages([]);
      setPartnerId(partnerIdFromState);
      setPartnerName(partnerNameFromState || '');
      
      // IMPORTANT: Set state to 'connecting' to wait for partner_connected confirmation
      // Don't enter 'chatting' until we confirm partner is actually connected
      setChatState('connecting');
      setNextButtonDisabled(true); // Disable Next button until partner connects
      setCanClickNext(false);
      nextButtonClickedRef.current = false;
      hasHandledLeave.current = false;
      leftManually.current = false; // Reset the flag for new session
      
      // Set timeout: if partner doesn't connect within 15 seconds, treat as no partner
      const partnerConnectionTimeout = setTimeout(() => {
        console.warn('⚠️ [ChatBox] Partner did not connect within 15 seconds, treating as no partner available');
        if (isMountedRef.current) {
          setMessages([{ text: 'Partner did not connect. Searching for a new partner...', from: 'system' }]);
          setChatState('searching');
          setPartnerId(null);
          setPartnerName('');
          sessionStorage.removeItem('partnerId');
          sessionStorage.removeItem('partnerName');
          // Re-queue for matchmaking
          if (socket && userId && userName) {
            handleNewBuddy();
          }
        }
      }, 15000);
      
      // Store timeout reference
      if (partnerConnectionTimeoutRef.current) {
        clearTimeout(partnerConnectionTimeoutRef.current);
      }
      partnerConnectionTimeoutRef.current = partnerConnectionTimeout;
      
      // Load original matchmaking criteria from sessionStorage if available
      originalEmotionRef.current = sessionStorage.getItem('originalEmotion') || null;
      originalLanguageRef.current = sessionStorage.getItem('originalLanguage') || null;
      const storedMode = sessionStorage.getItem('originalMode');
      originalModeRef.current = storedMode === 'null' ? null : (storedMode || null);
      
      // Clear any existing timeouts
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
        searchTimeout.current = null;
      }
      
      // Don't start tracking yet - wait for partner_connected
      // chatStartTime and trackSessionStart will be called in handlePartnerConnected
      
      console.log('⏳ [ChatBox] Chat session initialized from navigation, waiting for partner to connect...', {
        partnerId: partnerIdFromState,
        partnerName: partnerNameFromState,
        storedCriteria: { emotion: originalEmotionRef.current, language: originalLanguageRef.current, mode: originalModeRef.current }
      });
      
      // Connect to WebSocket if not already connected
      console.log('🔵 [ChatBox] Checking WebSocket connection', { 
        hasSocket: !!socket, 
        isConnected: socket?.connected,
        hasWs: !!socket?.ws,
        wsReadyState: socket?.ws?.readyState,
        sessionId: sessionIdFromState 
      });
      
      // Small delay to ensure context is ready
      const connectTimer = setTimeout(() => {
        if (socket) {
          // Check if WebSocket is already connected
          const wsReady = socket.ws && socket.ws.readyState === WebSocket.OPEN;
          console.log('🟡 [ChatBox] WebSocket state check', { 
            isConnected: socket.connected,
            hasWs: !!socket.ws,
            wsReadyState: socket.ws?.readyState,
            wsReady
          });
          
          if (!socket.connected && !wsReady) {
            console.log('🟢 [ChatBox] WebSocket not connected, connecting now...');
            // Use worker URL (localhost:8787 in dev), NOT frontend URL (localhost:5173)
            const workerURL = import.meta.env.VITE_WORKER_URL || (import.meta.env.DEV ? 'http://localhost:8787' : window.location.origin);
            const protocol = workerURL.startsWith('https') ? 'wss' : 'ws';
            const wsBase = workerURL.replace(/^https?:\/\//, '').replace(/\/$/, '');
            const wsUrl = `${protocol}://${wsBase}/chat?sessionId=${sessionIdFromState}&userId=${userId}&userName=${encodeURIComponent(userName)}`;
            console.log('🟢 [ChatBox] WebSocket URL:', { wsUrl, workerURL, wsBase });
            
            // Use connectToChat from context (exposed directly)
            if (connectToChatFromContext) {
              console.log('🟢 [ChatBox] Calling connectToChat from context');
              connectToChatFromContext(wsUrl, userId, userName);
            } else if (socket.connectToChat) {
              console.log('🟡 [ChatBox] Using socket.connectToChat');
              socket.connectToChat(wsUrl, userId, userName);
            } else {
              console.error('🔴 [ChatBox] connectToChat not available anywhere');
            }
          } else {
            console.log('✅ [ChatBox] WebSocket already connected or connecting', { 
              isConnected: socket.connected,
              hasWs: !!socket.ws,
              wsReadyState: socket.ws?.readyState,
              wsReadyStateText: socket.ws?.readyState === WebSocket.OPEN ? 'OPEN' : 
                                socket.ws?.readyState === WebSocket.CONNECTING ? 'CONNECTING' :
                                socket.ws?.readyState === WebSocket.CLOSING ? 'CLOSING' :
                                socket.ws?.readyState === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN'
            });
          }
        } else {
          console.warn('🔴 [ChatBox] Socket not available');
        }
      }, 100);
      
      return () => clearTimeout(connectTimer);
    }
    
    // No partner yet, start matchmaking
    if (initialMatchRequested.current) return;
    const delay = setTimeout(() => {
      handleNewBuddy();
      initialMatchRequested.current = true;
    }, 200);
    return () => clearTimeout(delay);
  }, [userId, deviceId, location.state]);

  useEffect(() => {
    if (!socket || !userId || !userName) return;
    
    const handlePartnerFound = (event) => {
      const { partnerId: foundPartnerId, partnerName: foundPartnerName, sessionId: foundSessionId, emotion, language, mode } = event.detail || {};
      if (!foundPartnerId) return;
      
      console.log('PARTNER FOUND PAYLOAD:', { partnerId: foundPartnerId, partnerName: foundPartnerName, sessionId: foundSessionId, emotion, language, mode });
      
      // Stop any active polling immediately
      if (matchmakingPollRef.current) {
        clearInterval(matchmakingPollRef.current);
        matchmakingPollRef.current = null;
        console.log('🛑 [ChatBox] Stopped polling in handlePartnerFound');
      }
      
      // Store original matchmaking criteria for reuse when clicking Next
      originalEmotionRef.current = emotion || sessionStorage.getItem('originalEmotion') || null;
      originalLanguageRef.current = language || sessionStorage.getItem('originalLanguage') || null;
      originalModeRef.current = mode || sessionStorage.getItem('originalMode') || null;
      
      // Persist in sessionStorage for reuse
      if (emotion) sessionStorage.setItem('originalEmotion', emotion);
      if (language) sessionStorage.setItem('originalLanguage', language);
      if (mode) sessionStorage.setItem('originalMode', mode);
      
      clearTimeout(searchTimeout.current);
      hasHandledLeave.current = false;
      leftManually.current = false; // Reset the flag for new session
      
      // Clear ALL previous chat session data before starting new session
      setMessages([]);
      setPartnerId(foundPartnerId);
      setPartnerName(foundPartnerName || 'Stranger');
      
      // Update sessionStorage (including sessionId for navigation check)
      sessionStorage.setItem('partnerId', foundPartnerId);
      sessionStorage.setItem('partnerName', foundPartnerName || 'Stranger');
      if (foundSessionId) {
        sessionStorage.setItem('sessionId', foundSessionId);
      }
      
      // IMPORTANT: Don't enter chat mode immediately - wait for partner_connected confirmation
      // Set state to 'connecting' to show we're waiting for partner to actually connect
      setChatState('connecting'); // New state: waiting for partner to connect
      setNextButtonDisabled(true); // Disable Next button until partner connects
      setCanClickNext(false);
      nextButtonClickedRef.current = false; // Reset Next button state
      hasHandledLeave.current = false;
      
      // Clear search timeout
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
        searchTimeout.current = null;
      }
      
      // Set timeout: if partner doesn't connect within 15 seconds, treat as no partner
      const partnerConnectionTimeout = setTimeout(() => {
        console.warn('⚠️ [ChatBox] Partner did not connect within 15 seconds, treating as no partner available');
        if (isMountedRef.current) {
          setMessages([{ text: 'Partner did not connect. Searching for a new partner...', from: 'system' }]);
          setChatState('searching');
          setPartnerId(null);
          setPartnerName('');
          sessionStorage.removeItem('partnerId');
          sessionStorage.removeItem('partnerName');
          // Re-queue for matchmaking
          if (socket && userId && userName) {
            handleNewBuddy();
          }
        }
      }, 15000);
      
      // Store timeout reference to clear it if partner connects
      if (!partnerConnectionTimeoutRef.current) {
        partnerConnectionTimeoutRef.current = partnerConnectionTimeout;
      } else {
        clearTimeout(partnerConnectionTimeoutRef.current);
        partnerConnectionTimeoutRef.current = partnerConnectionTimeout;
      }
      
      console.log('⏳ [ChatBox] Waiting for partner to connect...', {
        partnerId: foundPartnerId,
        storedCriteria: { emotion: originalEmotionRef.current, language: originalLanguageRef.current, mode: originalModeRef.current }
      });
    };
    
    // Handle partner_connected event - confirms partner is actually in the chat
    const handlePartnerConnected = (event) => {
      const data = event.detail || {};
      const connectedPartnerId = data.userId;
      const connectedPartnerName = data.userName;
      
      console.log('✅ [ChatBox] Partner connected confirmation received:', { connectedPartnerId, connectedPartnerName });
      
      // Clear partner connection timeout
      if (partnerConnectionTimeoutRef.current) {
        clearTimeout(partnerConnectionTimeoutRef.current);
        partnerConnectionTimeoutRef.current = null;
      }
      
      // Proceed if we're in 'connecting' state OR if we don't have a partnerId yet (timing issue)
      const currentPartnerId = partnerId || sessionStorage.getItem('partnerId');
      const shouldProcess = chatState === 'connecting' || (!currentPartnerId && chatState !== 'chatting');
      
      if (shouldProcess && connectedPartnerId) {
        console.log('✅ [ChatBox] Partner confirmed connected, entering chat mode', {
          chatState,
          connectedPartnerId,
          currentPartnerId,
          shouldProcess
        });
        playSound('join');
        
        // Now we can safely enter chat mode
        setChatState('chatting');
        setNextButtonDisabled(false); // Re-enable Next button
        setCanClickNext(true);
        
        // Update partner info if we got it from the event
        if (connectedPartnerId && !partnerId) {
          setPartnerId(connectedPartnerId);
        }
        if (connectedPartnerName && !partnerName) {
          setPartnerName(connectedPartnerName);
        }
        
        toast.success(`✅ Connected with ${connectedPartnerName || partnerName || 'Stranger'}`);
        
        chatStartTime.current = Date.now();
        trackSessionStart();
        
        console.log('✅ [ChatBox] Chat session started, partner confirmed connected', {
          partnerId: connectedPartnerId || currentPartnerId,
          partnerName: connectedPartnerName || partnerName
        });
      } else {
        console.log('⚠️ [ChatBox] Received partner_connected but state mismatch:', {
          chatState,
          connectedPartnerId,
          currentPartnerId,
          shouldProcess
        });
        
        // If we're already in 'chatting' but got partner_connected, it's a duplicate - ignore
        // But if we're in 'idle' or 'searching', maybe partner connected before we finished setup
        if (chatState === 'idle' || chatState === 'searching') {
          console.log('🟡 [ChatBox] Partner connected but we were in wrong state, updating anyway');
          setChatState('chatting');
          if (connectedPartnerId && !partnerId) {
            setPartnerId(connectedPartnerId);
          }
          if (connectedPartnerName && !partnerName) {
            setPartnerName(connectedPartnerName);
          }
          chatStartTime.current = Date.now();
          trackSessionStart();
        }
      }
    };

    const handlePartnerLeft = (eventData) => {
      const data = eventData?.detail || eventData || {};
      const leavingUserId = data.userId;
      
      // Get partnerId from multiple sources (state, sessionStorage, location.state) to handle timing issues
      const currentPartnerId = partnerId || sessionStorage.getItem('partnerId') || location.state?.partnerId;
      const currentPartnerName = partnerName || sessionStorage.getItem('partnerName') || location.state?.partnerName;
      
      console.log('📤 [ChatBox] handlePartnerLeft called', { 
        leavingUserId,
        currentUserId: userId,
        leftManually: leftManually.current,
        chatState,
        hasPartner: !!partnerId,
        currentPartnerId,
        partnerIdFromState: partnerId,
        partnerIdFromStorage: sessionStorage.getItem('partnerId'),
        partnerIdFromLocation: location.state?.partnerId,
        hasHandledLeave: hasHandledLeave.current
      });
      
      // Safety check: We need to be in a chat session to process partner_left
      // Check multiple sources for partnerId in case state hasn't updated yet
      // BUT: If we're in 'chatting' state, we should process partner_left even if partnerId isn't set yet (timing issue)
      const hasPartnerId = !!currentPartnerId;
      const isInChatSession = chatState === 'chatting' || !!sessionStorage.getItem('sessionId') || !!location.state?.sessionId;
      
      // CRITICAL: If user clicked Next themselves, they should NEVER process partner_left
      // The leftManually flag is set synchronously IMMEDIATELY when Next is clicked
      // This check must happen FIRST, before any other logic
      if (leftManually.current) {
        console.log('📤 [ChatBox] User clicked Next themselves, skipping partner_left message (leftManually is true)', {
          leftManually: leftManually.current,
          chatState,
          hasHandledLeave: hasHandledLeave.current
        });
        return;
      }
      
      // Prevent duplicate processing - if we've already handled a partner_left event, skip
      if (hasHandledLeave.current && chatState !== 'chatting') {
        console.log('📤 [ChatBox] Already handled partner_left, skipping duplicate event', {
          chatState,
          hasHandledLeave: hasHandledLeave.current
        });
        return;
      }
      
      if (!hasPartnerId && !isInChatSession) {
        console.log('📤 [ChatBox] No active partner and not in chat session, ignoring partner_left', { 
          partnerId, 
          chatState,
          fromState: location.state?.partnerId,
          fromStorage: sessionStorage.getItem('partnerId'),
          hasSessionId: !!sessionStorage.getItem('sessionId'),
          locationSessionId: !!location.state?.sessionId
        });
        return;
      }
      
      // Allow processing if we're in a valid chat state OR if we have a partnerId (might be transitioning)
      const isValidState = chatState === 'chatting' || chatState === 'searching' || chatState === 'noBuddy' || !!currentPartnerId || isInChatSession;
      if (!isValidState) {
        console.log('📤 [ChatBox] Not in valid state, ignoring partner_left', { partnerId: currentPartnerId, chatState, isInChatSession });
        return;
      }
      
      // Additional safety: Only process if the leaving user is actually our partner
      // BUT: If leavingUserId is null (from WebSocket close event), allow it (partner closed connection)
      // ALSO: If we're in a chat session and have no partnerId yet (timing issue), allow it
      const shouldProcessLeave = !leavingUserId || leavingUserId === currentPartnerId || (!currentPartnerId && isInChatSession);
      
      if (!shouldProcessLeave) {
        console.log('📤 [ChatBox] Leaving user is not our partner, ignoring', { 
          leavingUserId, 
          ourPartnerId: currentPartnerId,
          isInChatSession
        });
        return;
      }
      
      // Mark that we're handling leave to prevent duplicate processing
      hasHandledLeave.current = true;
      
      // Partner left - show system message and automatically re-queue
      playSound('leave');
      
      // Check if autoRequeue is requested (partner clicked Next)
      // If autoRequeue is explicitly true, always auto-requeue
      // Otherwise, if we're in a chat session (chatting state), default to auto-requeue
      // The server sends autoRequeue: true when partner clicks Next
      const shouldAutoRequeue = data.autoRequeue === true || (data.autoRequeue !== false && chatState === 'chatting');
      
      console.log('📤 [ChatBox] Processing partner_left, shouldAutoRequeue:', shouldAutoRequeue, {
        autoRequeueFromData: data.autoRequeue,
        chatState,
        isInChatSession
      });
      
      // Clear ALL previous messages and chat data when partner leaves
      if (shouldAutoRequeue) {
        setMessages([
          { text: 'Partner has left. Searching for a new partner...', from: 'system' },
        ]);
        setChatState('searching');
      } else {
        setMessages([
          { text: 'Partner has left the chat. Click "Next" to find a new buddy.', from: 'system' },
        ]);
        setChatState('noBuddy');
      }
      
      const previousPartnerId = currentPartnerId;
      
      // Update state with partnerId if we got it from storage/location but not from state yet
      if (!partnerId && currentPartnerId) {
        setPartnerId(currentPartnerId);
      }
      if (!partnerName && currentPartnerName) {
        setPartnerName(currentPartnerName);
      }
      
      // Now clear the partner info
      setPartnerId(null);
      setPartnerName('');
      trackSessionEnd();
      sessionStorage.removeItem('partnerId');
      sessionStorage.removeItem('partnerName');
      
      // Close WebSocket connection (server already closed it, but ensure clean state)
      if (socket && socket.ws && (socket.ws.readyState === WebSocket.OPEN || socket.ws.readyState === WebSocket.CONNECTING)) {
        try {
          socket.ws.close(1000, 'Partner left - session ended');
        } catch (error) {
          console.error('🔴 [ChatBox] Error closing WebSocket after partner left:', error);
        }
      }
      
      if (shouldAutoRequeue) {
        // Automatically re-queue the user with same criteria (no need to click Next)
        console.log('📤 [ChatBox] Partner clicked Next, auto-requeuing User B with same criteria');
        
        // Get original matchmaking criteria from refs or sessionStorage
        const emotion = originalEmotionRef.current || sessionStorage.getItem('originalEmotion') || null;
        const language = originalLanguageRef.current || sessionStorage.getItem('originalLanguage') || null;
        const storedMode = originalModeRef.current !== null ? originalModeRef.current : (sessionStorage.getItem('originalMode') || null);
        const mode = storedMode === 'null' ? null : storedMode;
        
        // Update state to searching
        setChatState('searching');
        setMessages([{ text: 'Partner has left. Searching for a new partner...', from: 'system' }]);
        
        // Reset Next button state (but keep leftManually true if we're the one who clicked Next)
        setNextButtonDisabled(false);
        setCanClickNext(true);
        nextButtonClickedRef.current = false;
        hasHandledLeave.current = false;
        // Only reset leftManually if we're NOT the one who clicked Next
        // leftManually will be reset when User A processes their own Next click
        if (!leftManually.current) {
          leftManually.current = false;
        }
        
        // Start new matchmaking with ORIGINAL criteria
        // Add a slightly longer delay for User B to ensure User A has already been queued
        console.log('🟢 [ChatBox] Setting up auto-requeue matchmaking, will start in 500ms...', { emotion, language, mode, hasConnectToMatch: !!(connectToMatch) });
        
        setTimeout(async () => {
          console.log('🟢 [ChatBox] Auto-requeue timeout fired, checking connectToMatch...', { hasConnectToMatch: !!(connectToMatch), userId, userName, deviceId });
          
          // Use connectToMatch directly from context
          if (connectToMatch && typeof connectToMatch === 'function') {
            try {
              console.log('🟢 [ChatBox] Auto-requeuing after partner left with criteria:', { emotion, language, mode });
              
              // Make first matchmaking call
              const firstResult = await connectToMatch(userId, userName, deviceId, emotion, language, mode);
              
              // If matched immediately, partner_found event will handle it
              if (firstResult && firstResult.matched) {
                console.log('✅ [ChatBox] Immediate match found after auto-requeue');
                return;
              }
              
              // Clear any existing polling interval before starting new one
              if (matchmakingPollRef.current) {
                clearInterval(matchmakingPollRef.current);
                matchmakingPollRef.current = null;
              }
              
              // Set up polling for matchmaking (poll every 2 seconds)
              let pollCount = 0;
              const maxPolls = 30; // 60 seconds total (30 * 2 seconds)
              
              matchmakingPollRef.current = setInterval(async () => {
                // Check if component is still mounted
                if (!isMountedRef.current) {
                  if (matchmakingPollRef.current) {
                    clearInterval(matchmakingPollRef.current);
                    matchmakingPollRef.current = null;
                  }
                  return;
                }
                
                pollCount++;
                console.log(`🟡 [ChatBox] Polling for match (attempt ${pollCount}/${maxPolls})`);
                
                try {
                  const result = await connectToMatch(userId, userName, deviceId, emotion, language, mode);
                  if (result && result.matched) {
                    console.log('✅ [ChatBox] Match found during polling after auto-requeue');
                    if (matchmakingPollRef.current) {
                      clearInterval(matchmakingPollRef.current);
                      matchmakingPollRef.current = null;
                    }
                    // partner_found event will handle navigation
                  } else if (pollCount >= maxPolls) {
                    console.log('⏰ [ChatBox] Max polls reached after auto-requeue');
                    if (matchmakingPollRef.current) {
                      clearInterval(matchmakingPollRef.current);
                      matchmakingPollRef.current = null;
                    }
                    if (isMountedRef.current) {
                      notifyNoBuddy();
                    }
                  }
                } catch (error) {
                  console.error('🔴 [ChatBox] Polling error after auto-requeue:', error);
                  if (matchmakingPollRef.current) {
                    clearInterval(matchmakingPollRef.current);
                    matchmakingPollRef.current = null;
                  }
                  if (isMountedRef.current) {
                    notifyNoBuddy();
                  }
                }
              }, 2000); // Poll every 2 seconds
              
              // Store interval ref for cleanup
              if (searchTimeout.current) {
                clearTimeout(searchTimeout.current);
              }
              searchTimeout.current = setTimeout(() => {
                if (matchmakingPollRef.current) {
                  clearInterval(matchmakingPollRef.current);
                  matchmakingPollRef.current = null;
                }
                if (isMountedRef.current) {
                  console.log('⏰ [ChatBox] Search timeout (60s) reached after auto-requeue');
                  notifyNoBuddy();
                }
              }, 60000);
            } catch (error) {
              console.error('🔴 [ChatBox] Auto-requeue matchmaking error:', error);
              toast.error('Failed to find new partner');
              setChatState('noBuddy');
              setNextButtonDisabled(false);
              nextButtonClickedRef.current = false;
            }
          }
        }, 500); // Longer delay for User B to ensure User A has already been queued
      } else {
        // Manual Next required (legacy support)
        setNextButtonDisabled(false);
        setCanClickNext(true);
        nextButtonClickedRef.current = false;
        
        hasHandledLeave.current = false;
        leftManually.current = false;
        
        if (searchTimeout.current) {
          clearTimeout(searchTimeout.current);
        }
        
        console.log('📤 [ChatBox] Partner left, Next button enabled (manual click required)', {
          userId,
          partnerWas: previousPartnerId
        });
      }
    };
    const handleChatMessage = (event) => {
      const msg = event.detail || event;
      console.log('📨 [ChatBox] handleChatMessage received:', msg);
      
      // Handle both formats: {type: "chatMessage", ...} or direct message object
      const messageObj = msg.type === 'chatMessage' ? msg : (msg.message ? msg : null);
      
      if (messageObj && messageObj.message) {
        setMessages((msgs) => {
          // Create unique message ID for O(1) deduplication
          const msgId = `${messageObj.timestamp}_${messageObj.userId}_${++messageCounterRef.current}`;
          
          // O(1) lookup instead of O(n) array search
          if (messageIdsRef.current.has(msgId)) {
            console.warn('⚠️ [ChatBox] Duplicate message detected, skipping');
            return msgs;
          }
          
          messageIdsRef.current.add(msgId);
          console.log('✅ [ChatBox] Adding message to state:', messageObj);
          
          // Limit to last 100 messages for performance
          const newMsgs = [...msgs, messageObj];
          if (newMsgs.length > 100) {
            const removed = newMsgs.shift();
            // Remove oldest message ID from set
            const removedIds = Array.from(messageIdsRef.current).filter(id => id.startsWith(`${removed.timestamp}_${removed.userId}_`));
            removedIds.forEach(id => messageIdsRef.current.delete(id));
          }
          return newMsgs;
        });
      } else {
        console.warn('⚠️ [ChatBox] Invalid message format:', msg);
      }
    };
    const handleSuspended = ({ message }) => {
      toast.error(message || '⚠️ You are temporarily suspended.');
      sessionStorage.clear();
      navigate('/', { replace: true });
    };
    const handleReportReceived = ({ status, message }) => {
      if (status === 'accepted') {
        toast.success('Report submitted. Searching for a new match...');
        handleNext();
      } else {
        toast.info(message);
      }
    };
    const handleReportWarning = (msg) => {
      toast.warn(msg || 'You have been reported. Please behave properly.');
    };
    const handleNextAck = () => {
      if (!leftManually.current) return;
      leftManually.current = false;
      hasHandledLeave.current = false;
      socket.emit('find_new_buddy', { userId, userName, deviceId });
      clearTimeout(searchTimeout.current);
      searchTimeout.current = setTimeout(() => {
        notifyNoBuddy();
        socket.emit('leave_chat', { userId });
      }, 60000);
      toast.success('Searching for a new buddy...');
    };
    // Use window events for WebSocket messages (compatible with both Socket.io and WebSocket)
    const handlePartnerFoundEvent = (e) => handlePartnerFound(e);
    const handlePartnerLeftEvent = (e) => {
      // Pass the entire event to handlePartnerLeft for proper data extraction
      handlePartnerLeft(e);
    };
    const handleChatMessageEvent = (e) => handleChatMessage(e);
    const handleRoomClosedEvent = (e) => {
      const data = e.detail || {};
      const reason = data.reason || 'Chat room closed';
      
      console.log('🔴 [ChatBox] Room closed event received:', { reason });
      
      // Check if this is browser navigation (partner closed/back/refresh)
      // In this case, User B should auto-requeue instead of navigating away
      const isPartnerBrowserNavigation = reason.includes('browser navigation') || reason.includes('Browser');
      
      if (isPartnerBrowserNavigation) {
        // Partner closed browser/back/refresh - auto-requeue User B to same queue
        console.log('🟢 [ChatBox] Partner left via browser navigation, auto-requeuing User B');
        
        // Mark that we're handling this
        hasHandledLeave.current = true;
        
        // Get original matchmaking criteria from refs or sessionStorage
        const emotion = originalEmotionRef.current || sessionStorage.getItem('originalEmotion') || null;
        const language = originalLanguageRef.current || sessionStorage.getItem('originalLanguage') || null;
        const storedMode = originalModeRef.current !== null ? originalModeRef.current : (sessionStorage.getItem('originalMode') || null);
        const mode = storedMode === 'null' ? null : storedMode;
        
        // Clear partner info but keep original criteria
        setMessages([{ text: 'Partner has left. Searching for a new partner...', from: 'system' }]);
        setChatState('searching');
        setPartnerId(null);
        setPartnerName('');
        setNextButtonDisabled(false);
        setCanClickNext(true);
        nextButtonClickedRef.current = false;
        hasHandledLeave.current = false;
        leftManually.current = false;
        
        // Clear only partner-related sessionStorage, keep original criteria
        sessionStorage.removeItem('partnerId');
        sessionStorage.removeItem('partnerName');
        sessionStorage.removeItem('sessionId');
        
        // Close WebSocket connection
        if (socket && socket.ws && (socket.ws.readyState === WebSocket.OPEN || socket.ws.readyState === WebSocket.CONNECTING)) {
          try {
            socket.ws.close(1000, 'Partner left via browser navigation - auto-requeuing');
          } catch (error) {
            console.error('🔴 [ChatBox] Error closing WebSocket on room_closed:', error);
          }
        }
        
        trackSessionEnd();
        
        // Auto-requeue with original criteria
        setTimeout(async () => {
          if (connectToMatch && typeof connectToMatch === 'function') {
            try {
              console.log('🟢 [ChatBox] Auto-requeuing after partner browser navigation with criteria:', { emotion, language, mode });
              
              const firstResult = await connectToMatch(userId, userName, deviceId, emotion, language, mode);
              
              if (firstResult && firstResult.matched) {
                console.log('✅ [ChatBox] Immediate match found after auto-requeue (browser navigation)');
                return;
              }
              
              // Set up polling
              if (matchmakingPollRef.current) {
                clearInterval(matchmakingPollRef.current);
                matchmakingPollRef.current = null;
              }
              
              let pollCount = 0;
              const maxPolls = 30;
              
              matchmakingPollRef.current = setInterval(async () => {
                if (!isMountedRef.current || partnerIdRef.current || sessionStorage.getItem('partnerId')) {
                  if (matchmakingPollRef.current) {
                    clearInterval(matchmakingPollRef.current);
                    matchmakingPollRef.current = null;
                  }
                  return;
                }
                
                pollCount++;
                try {
                  const result = await connectToMatch(userId, userName, deviceId, emotion, language, mode);
                  if (result && result.matched) {
                    if (matchmakingPollRef.current) {
                      clearInterval(matchmakingPollRef.current);
                      matchmakingPollRef.current = null;
                    }
                  } else if (pollCount >= maxPolls) {
                    if (matchmakingPollRef.current) {
                      clearInterval(matchmakingPollRef.current);
                      matchmakingPollRef.current = null;
                    }
                    if (isMountedRef.current) {
                      notifyNoBuddy();
                    }
                  }
                } catch (error) {
                  console.error('🔴 [ChatBox] Polling error after auto-requeue (browser navigation):', error);
                  if (matchmakingPollRef.current) {
                    clearInterval(matchmakingPollRef.current);
                    matchmakingPollRef.current = null;
                  }
                  if (isMountedRef.current) {
                    notifyNoBuddy();
                  }
                }
              }, 2000);
            } catch (error) {
              console.error('🔴 [ChatBox] Auto-requeue error after browser navigation:', error);
              setChatState('noBuddy');
              setNextButtonDisabled(false);
            }
          }
        }, 500);
        
        return; // Don't navigate away - auto-requeue instead
      }
      
      // For other room_closed scenarios (not browser navigation), navigate away
      // Mark that we're handling this to prevent duplicate processing
      hasHandledLeave.current = true;
      
      // Show message and cleanup immediately
      toast.warn(`⚠️ ${reason}`);
      
      // Clear all chat session data
      setMessages([]);
      setPartnerId(null);
      setPartnerName(null);
      setChatState('idle');
      setNextButtonDisabled(false);
      setCanClickNext(true);
      
      // Clear session storage
      sessionStorage.clear();
      
      // Close WebSocket if still open
      if (socket && socket.ws && (socket.ws.readyState === WebSocket.OPEN || socket.ws.readyState === WebSocket.CONNECTING)) {
        try {
          socket.ws.close(1000, 'Room closed');
        } catch (error) {
          console.error('🔴 [ChatBox] Error closing WebSocket on room_closed:', error);
        }
      }
      
      // Track session end
      trackSessionEnd();
      
      // Navigate back to home page to ensure user is completely out of chat
      console.log('🔴 [ChatBox] Navigating to home page - room closed');
      navigate('/', { replace: true });
    };

    window.addEventListener('partner_found', handlePartnerFoundEvent);
    window.addEventListener('partner_connected', handlePartnerConnected);
    window.addEventListener('partner_left', handlePartnerLeftEvent);
    window.addEventListener('chatMessage', handleChatMessageEvent);
    window.addEventListener('room_closed', handleRoomClosedEvent);

    // Listen via socket.on for events that don't use window events (for Socket.io compatibility)
    // Note: chatMessage, partner_found, partner_left are handled via window events above to avoid duplicates
    if (socket && typeof socket.on === 'function') {
      // These events are NOT dispatched as window events, so safe to use socket.on
      socket.on('no_buddy_found', () => {
        notifyNoBuddy();
        if (socket.emit) socket.emit('leave_chat', { userId });
      });
      socket.on('partner_idle', () =>
        toast.info('⚠️ Your partner seems idle.', { toastId: 'partner-idle' })
      );
      socket.on('partner_active', () => toast.dismiss('partner-idle'));
      socket.on('suspended', handleSuspended);
      socket.on('report_received', handleReportReceived);
      socket.on('report_warning', handleReportWarning);
      socket.on('next_ack', handleNextAck);
      socket.on('partner_disconnected', () => {
        setPartnerId(null);
        setPartnerName(null);
        sessionStorage.removeItem('partnerId');
        sessionStorage.removeItem('partnerName');
        toast.warn('⚠️ Partner disconnected');
      });
    }

    return () => {
      window.removeEventListener('partner_found', handlePartnerFoundEvent);
      window.removeEventListener('partner_connected', handlePartnerConnected);
      window.removeEventListener('partner_left', handlePartnerLeftEvent);
      window.removeEventListener('chatMessage', handleChatMessageEvent);
      window.removeEventListener('room_closed', handleRoomClosedEvent);
      
      // Clean up partner connection timeout
      if (partnerConnectionTimeoutRef.current) {
        clearTimeout(partnerConnectionTimeoutRef.current);
        partnerConnectionTimeoutRef.current = null;
      }
      
      if (socket && typeof socket.off === 'function') {
        // Only clean up socket.on listeners that were actually registered
        // chatMessage, partner_found, partner_left use window events, not socket.on
        socket.off('no_buddy_found');
        socket.off('partner_idle');
        socket.off('partner_active');
        socket.off('suspended', handleSuspended);
        socket.off('report_received', handleReportReceived);
        socket.off('report_warning', handleReportWarning);
        socket.off('next_ack', handleNextAck);
      }
      clearTimeout(searchTimeout.current);
    };
  }, [socket, userId, userName, deviceId]);

  useEffect(() => {
    if (!socket || !userId) return;

    const handleActivity = () => {
      if (isIdle.current) {
        isIdle.current = false;
        socket.emit('heartbeat', { userId });
      }
      clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        isIdle.current = true;
        socket.emit('user_idle', { userId });
      }, 60000);
    };

    ['mousemove', 'keydown', 'click'].forEach((e) =>
      window.addEventListener(e, handleActivity)
    );
    handleActivity();

    const interval = setInterval(() => {
      if (!isIdle.current) socket.emit('heartbeat', { userId });
    }, 15000);

    return () => {
      ['mousemove', 'keydown', 'click'].forEach((e) =>
        window.removeEventListener(e, handleActivity)
      );
      clearTimeout(idleTimer.current);
      clearInterval(interval);
    };
  }, [socket, userId]);

  // Removed auto-leave on tab hidden; users will only leave on explicit actions

  useEffect(() => {
    const updateHeight = () => {
      if (listContainerRef.current) {
        setListHeight(listContainerRef.current.clientHeight);
      }
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollToItem(messages.length - 1);
    }
  }, [messages]);

  // Cleanup effect when component unmounts
  useEffect(() => {
    // Mark component as mounted
    isMountedRef.current = true;
    
    return () => {
      // Mark component as unmounted to prevent state updates
      isMountedRef.current = false;
      
      // Clear all timers and intervals
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
        searchTimeout.current = null;
      }
      if (matchmakingPollRef.current) {
        clearInterval(matchmakingPollRef.current);
        matchmakingPollRef.current = null;
      }
      if (idleTimer.current) {
        clearTimeout(idleTimer.current);
        idleTimer.current = null;
      }
      
      // Ensure chat session is properly closed when component unmounts
      if (socket && userIdRef.current && partnerIdRef.current && !hasHandledLeave.current) {
        socket.emit('leave_chat', { userId: userIdRef.current });
        hasHandledLeave.current = true;
        trackSessionEnd();
      }
    };
  }, []);

  // Handle browser navigation and page unload
  useEffect(() => {
    const notifyPartnerAndCleanup = (reason) => {
      if (chatState === 'chatting' && socket && userId && partnerId && !hasHandledLeave.current) {
        console.log(`🔴 [ChatBox] Notifying partner before browser ${reason}`, { userId, partnerId });
        
        // Mark as handled immediately to prevent duplicate notifications
        hasHandledLeave.current = true;
        
        // Send "next" message to server FIRST to notify partner immediately
        // This ensures partner gets notified before WebSocket closes
        if (socket.ws && socket.ws.readyState === WebSocket.OPEN) {
          try {
            const nextMessage = JSON.stringify({ 
              type: 'next', 
              userId, 
              timestamp: Date.now(), 
              reason: reason.includes('unload') ? 'Browser unload' : reason.includes('refresh') ? 'Browser refresh' : reason 
            });
            socket.ws.send(nextMessage);
            console.log(`✅ [ChatBox] Sent "next" message to partner before ${reason}`);
            
            // For unload/close/refresh, don't wait - message is sent, let server handle cleanup
            // Server will close connection after notifying partner
          } catch (error) {
            console.error(`🔴 [ChatBox] Error sending next message before ${reason}:`, error);
          }
        } else if (socket.ws) {
          console.warn(`⚠️ [ChatBox] WebSocket not open during ${reason}, readyState:`, socket.ws.readyState);
        }
        
        trackSessionEnd();
      }
    };
    
    const handleBeforeUnload = (e) => {
      if (chatState === 'chatting' && socket && userId && partnerId && !hasHandledLeave.current) {
        // Notify partner before unload/refresh/close
        notifyPartnerAndCleanup('refresh/close');
        
        // For modern browsers, we can show a confirmation
        e.preventDefault();
        e.returnValue = '';
      }
    };

    const handleUnload = () => {
      // Notify partner on unload (browser close/refresh)
      notifyPartnerAndCleanup('unload');
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('unload', handleUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleUnload);
    };
  }, [chatState, socket, userId, partnerId, trackSessionEnd]);

  useExitProtection({
    enabled: chatState === 'chatting',
    onBack: () => {
      console.log('🔴 [ChatBox] Browser back button clicked, notifying partner and cleaning up');
      
      if (socket && userId && partnerId && !hasHandledLeave.current) {
        // Mark as handled immediately to prevent duplicate notifications
        hasHandledLeave.current = true;
        
        // Send "next" message to server FIRST to notify partner immediately
        // Use requestAnimationFrame to ensure message is queued before any navigation
        if (socket.ws && socket.ws.readyState === WebSocket.OPEN) {
          try {
            const nextMessage = JSON.stringify({ 
              type: 'next', 
              userId, 
              timestamp: Date.now(),
              reason: 'Browser back navigation'
            });
            
            // Send message synchronously (WebSocket.send queues it)
            socket.ws.send(nextMessage);
            console.log('✅ [ChatBox] Sent "next" message to partner before browser back navigation');
            
            // CRITICAL: Wait longer to ensure message reaches server before navigation
            // Use multiple animation frames + timeout to ensure message is transmitted
            // The browser might close WebSocket during navigation, so we need to wait
            let framesWaited = 0;
            const checkAndNavigate = () => {
              framesWaited++;
              
              // Wait at least 2 frames + 500ms to ensure message is transmitted
              if (framesWaited < 2) {
                requestAnimationFrame(checkAndNavigate);
                return;
              }
              
              // Additional timeout to ensure server receives and processes message
              setTimeout(() => {
                console.log('⏳ [ChatBox] Waiting period complete, proceeding with navigation');
                
                // Clean up local state
                try {
                  if (socket && typeof socket.off === 'function') {
                    socket.off('chat_message');
                    socket.off('chatMessage');
                  }
                } catch (error) {
                  console.error('🔴 [ChatBox] Error cleaning up socket listeners:', error);
                }
                
                trackSessionEnd();
                sessionStorage.clear();
                
                // Update state before navigation
                if (isMountedRef.current) {
                  setChatState('idle');
                  setPartnerId(null);
                  setMessages([]);
                }
                
                // DON'T close WebSocket manually - let server handle it after sending notifications
                // Navigate - server will close WebSocket after processing message
                if (isMountedRef.current) {
                  navigate('/', { replace: true });
                }
              }, 500); // 500ms delay to ensure server receives message
            };
            
            requestAnimationFrame(checkAndNavigate);
            return; // Exit early, cleanup happens in requestAnimationFrame
          } catch (error) {
            console.error('🔴 [ChatBox] Error sending next message before browser back:', error);
            // Fall through to cleanup if send fails
          }
        } else if (socket.ws) {
          console.warn('⚠️ [ChatBox] WebSocket not open, readyState:', socket.ws.readyState);
        }
        
        // Fallback: If message couldn't be sent, still cleanup and navigate
        try {
          if (socket && typeof socket.off === 'function') {
            socket.off('chat_message');
            socket.off('chatMessage');
          }
        } catch (error) {
          console.error('🔴 [ChatBox] Error cleaning up socket listeners:', error);
        }
        
        trackSessionEnd();
        sessionStorage.clear();
        
        if (isMountedRef.current) {
          setChatState('idle');
          setPartnerId(null);
          setMessages([]);
          navigate('/', { replace: true });
        }
        
        // Close WebSocket
        if (socket.ws && (socket.ws.readyState === WebSocket.OPEN || socket.ws.readyState === WebSocket.CONNECTING)) {
          try {
            socket.ws.close(1000, 'Browser back navigation');
          } catch (error) {
            console.error('🔴 [ChatBox] Error closing WebSocket on back navigation:', error);
          }
        }
      } else {
        // No active session, just cleanup and navigate immediately
        hasHandledLeave.current = true;
        trackSessionEnd();
        sessionStorage.clear();
        setChatState('idle');
        setPartnerId(null);
        setMessages([]);
        navigate('/', { replace: true });
      }
    },
    onRefresh: () => {
      console.log('🔴 [ChatBox] Browser refresh detected, notifying partner and cleaning up');
      
      if (socket && userId && partnerId && !hasHandledLeave.current) {
        // Mark as handled immediately to prevent duplicate notifications
        hasHandledLeave.current = true;
        
        // Send "next" message to server FIRST to notify partner immediately
        if (socket.ws && socket.ws.readyState === WebSocket.OPEN) {
          try {
            const nextMessage = JSON.stringify({ 
              type: 'next', 
              userId, 
              timestamp: Date.now(),
              reason: 'Browser refresh'
            });
            socket.ws.send(nextMessage);
            console.log('✅ [ChatBox] Sent "next" message to partner before browser refresh');
          } catch (error) {
            console.error('🔴 [ChatBox] Error sending next message before refresh:', error);
          }
        }
        
        // Close WebSocket after notifying partner
        setTimeout(() => {
          if (socket.ws && (socket.ws.readyState === WebSocket.OPEN || socket.ws.readyState === WebSocket.CONNECTING)) {
            try {
              socket.ws.close(1000, 'Browser refresh');
            } catch (error) {
              console.error('🔴 [ChatBox] Error closing WebSocket on refresh:', error);
            }
          }
          
          if (socket) socket.disconnect();
          trackSessionEnd();
          sessionStorage.clear();
        }, 50); // Very short delay to ensure message is sent
      } else {
        if (socket) socket.disconnect();
        hasHandledLeave.current = true;
        trackSessionEnd();
        sessionStorage.clear();
      }
    },
    showExitConfirmToast: () => showMobileExitToast(() => {
      console.log('🔴 [ChatBox] Mobile exit confirmed, notifying partner and cleaning up');
      
      if (socket && userId && partnerId && !hasHandledLeave.current) {
        // Mark as handled immediately to prevent duplicate notifications
        hasHandledLeave.current = true;
        
        let messageSent = false;
        
        // Send "next" message to server FIRST to notify partner immediately
        // This MUST happen synchronously before any cleanup
        if (socket.ws && socket.ws.readyState === WebSocket.OPEN) {
          try {
            const nextMessage = JSON.stringify({ 
              type: 'next', 
              userId, 
              timestamp: Date.now(),
              reason: 'Mobile exit'
            });
            socket.ws.send(nextMessage);
            messageSent = true;
            console.log('✅ [ChatBox] Sent "next" message to partner before mobile exit');
          } catch (error) {
            console.error('🔴 [ChatBox] Error sending next message before mobile exit:', error);
          }
        } else if (socket.ws) {
          console.warn('⚠️ [ChatBox] WebSocket not open, readyState:', socket.ws.readyState);
        }
        
        // Wait longer to ensure message is transmitted before closing connection
        const cleanupDelay = messageSent ? 300 : 100; // Longer delay if message was sent
        
        setTimeout(() => {
          // Try to close WebSocket gracefully
          if (socket.ws && (socket.ws.readyState === WebSocket.OPEN || socket.ws.readyState === WebSocket.CONNECTING)) {
            try {
              socket.ws.close(1000, 'Mobile exit');
            } catch (error) {
              console.error('🔴 [ChatBox] Error closing WebSocket on mobile exit:', error);
            }
          }
          
          // Clean up local state
          try {
            if (socket && typeof socket.off === 'function') {
              socket.off('chat_message');
              socket.off('chatMessage');
            }
          } catch (error) {
            console.error('🔴 [ChatBox] Error cleaning up socket listeners:', error);
          }
          
          trackSessionEnd();
          sessionStorage.clear();
          
          // Only update state if component is still mounted
          if (isMountedRef.current) {
            setChatState('idle');
            setPartnerId(null);
            setMessages([]);
            navigate('/', { replace: true });
          }
        }, cleanupDelay);
      } else {
        hasHandledLeave.current = true;
        trackSessionEnd();
        sessionStorage.clear();
        setChatState('idle');
        setPartnerId(null);
        setMessages([]);
        navigate('/', { replace: true });
      }
    }),
  });

  return (
    <div className={`w-full flex justify-center ${theme === 'dark' ? 'bg-gray-900' : 'bg-[#EAF6FF]'} transition-colors duration-300 h-[100dvh] overflow-y-auto`}>
      <div className="w-full h-full flex flex-col">
            <div className={`flex flex-col w-full h-full max-w-full sm:max-w-[90vw] md:max-w-[600px] lg:max-w-[700px] xl:max-w-[900px] sm:rounded-2xl ${theme === 'dark' ? 'bg-gray-800 text-white' : 'bg-[#f8f9fa] text-[#222e35]'} shadow-2xl overflow-hidden relative font-[system-ui,sans-serif] text-base border sm:border-0`} data-chat-state={chatState}>
          {/* Header */}
          <div className={`h-16 shrink-0 flex items-center justify-between px-4 py-4 ${theme === 'dark' ? 'bg-gray-700 text-white' : 'bg-[#BFE8FF] text-[#0b3a5b]'} shadow-sm border-b ${theme === 'dark' ? 'border-gray-600' : 'border-[#A7D8F5]'} z-20`}>
            <span className="font-semibold text-2xl tracking-wide">
              {partnerName ? partnerName : "Waiting for partner"}
            </span>
            <button onClick={toggleTheme} className={`ml-auto p-2 rounded-full hover:bg-opacity-20 ${theme === 'dark' ? 'hover:bg-gray-600' : 'hover:bg-black hover:bg-opacity-20'}`}>
              {theme === 'light' ? '🌙' : '☀️'}
            </button>
          </div>
          {/* Chat area */}
          <div
            className={`flex-1 flex flex-col overflow-hidden relative ${theme === 'dark' ? 'bg-gray-800' : 'bg-white'}`}
          >
            {/* Scrollable message list */}
            <div className="flex-1 overflow-y-auto px-3 pt-4 pb-2 no-scrollbar" ref={listContainerRef}>
              {messages.map((msg, index) => (
                <div
                  key={msg.timestamp || index}
                  className={msg.from === 'system' ? 'flex justify-center my-2' :
                    msg.userId === userId ? 'flex justify-end mt-1 mb-1' : 'flex justify-start mt-1 mb-1'}
                >
                  {msg.message?.trim() && (
                    <SpeechBubble isSender={msg.userId === userId} theme={theme}>
                      {msg.message}
                    </SpeechBubble>
                  )}
                  {msg.from === 'system' && (
                    <div className={`italic text-sm ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>{msg.text}</div>
                  )}
                </div>
              ))}
            </div>
            {/* Input + Footer */}
            <div className={`shrink-0 px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+26px)] bg-inherit`}>
              <ChatInput
                input={input}
                inputError={inputError}
                chatState={chatState}
                handleInputChange={handleInputChange}
                handleSend={handleSend}
                inputRef={inputRef}
                theme={theme}
              />
              {!keyboardVisible && (
                <div className="mt-2">
                  <ChatFooter
                    handleNext={handleNext}
                    handleReport={handleReport}
                    theme={theme}
                    nextDisabled={nextButtonDisabled || chatState === 'searching' || chatState === 'connecting'}
                  />
                </div>
              )}
            </div>
          </div>

          <ToastContainer
            position="bottom-right"
            autoClose={3000}
            closeOnClick
            pauseOnHover
          />
        </div>
      </div>
    </div>
  );
};
export default ChatBox;
