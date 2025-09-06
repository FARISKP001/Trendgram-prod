import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import useSocketContext from '../context/useSocketContext';
import joinSound from '../assets/join.mp3';
import leaveSound from '../assets/leave.mp3';
import doodleBg from '../assets/doodle-bg.jpg';
import useExitProtection from '../hooks/useExitProtection';
import { FixedSizeList as List } from 'react-window';
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
  const { socket, isConnected } = useSocketContext();
  const location = useLocation();
  const navigate = useNavigate();
  const leftManually = useRef(false);
  const [deviceId, setDeviceId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState('');
  const [partnerId, setPartnerId] = useState(null);
  const [partnerName, setPartnerName] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatState, setChatState] = useState('idle');
  const [inputError, setInputError] = useState('');
  const searchTimeout = useRef(null);
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
  }, [location.state, navigate]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { partnerIdRef.current = partnerId; }, [partnerId]);



  const playSound = (type) => new Audio(type === 'join' ? joinSound : leaveSound).play();

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
    if (!input.trim() || chatState !== 'chatting' || !partnerId) return;
    const validation = validateText(input);
    if (!validation.valid) {
      toast.error('Message contains invalid content.');
      return;
    }
    const sanitized = sanitizeMessage(input);
    socket.emit('chatMessage', {
      userId,
      userName,
      partnerId,
      message: sanitized,
      timestamp: Date.now(),
    });
    trackMessageSent(sanitized);
    setInput('');
  };


  const notifyNoBuddy = () => {
    setMessages([{ text: "Partner's are not available.", from: 'system' }]);
    setChatState('noBuddy');
  };

  const handleNext = () => {
    if (chatState === 'searching' || hasHandledLeave.current) return;
    if (!socket?.connected) return toast.error('Unable to connect to server. Please refresh.');

    leftManually.current = true;
    setMessages([{ text: 'You left the chat. Searching for a new buddy...', from: 'system' }]);
    setChatState('searching');
    setPartnerId(null);
    setPartnerName('');
    sessionStorage.removeItem('partnerId');
    sessionStorage.removeItem('partnerName');
    trackSessionEnd();
    socket.emit('next', { userId, userName, deviceId });
    hasHandledLeave.current = true;
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      notifyNoBuddy();
      socket.emit('leave_chat', { userId });
    }, 60000);
  };

  const handleNewBuddy = () => {
    if (chatState === 'chatting' || partnerId || !deviceId) return;
    if (!socket?.connected) return toast.error('Unable to connect to server.');
    hasHandledLeave.current = false;
    setChatState('searching');
    setPartnerId(null);
    setMessages([]);
    sessionStorage.removeItem('partnerId');
    sessionStorage.removeItem('partnerName');
    socket.emit('find_new_buddy', { userId, userName, deviceId });
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      notifyNoBuddy();
      socket.emit('leave_chat', { userId });
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

  // Partner found: expect backend to send partnerName in payload!
  useEffect(() => {
    if (!socket?.connected || !userId || !deviceId) return;
    const partnerIdFromState = location.state?.partnerId;
    const partnerNameFromState = location.state?.partnerName;
    if (partnerIdFromState) {
      setPartnerId(partnerIdFromState);
      setPartnerName(partnerNameFromState || '');
      setChatState('chatting');
      trackSessionStart();
      return;
    }
    registerUser();
    if (initialMatchRequested.current) return;
    const delay = setTimeout(() => {
      handleNewBuddy();
      initialMatchRequested.current = true;
    }, 200);
    return () => clearTimeout(delay);
  }, [socket?.id, isConnected, userId, deviceId]);

  useEffect(() => {
    if (!socket || !userId || !userName || !isConnected) return;
    const handlePartnerFound = ({ partnerId, partnerName }) => {
      console.log('PARTNER FOUND PAYLOAD:', { partnerId, partnerName });
      clearTimeout(searchTimeout.current);
      hasHandledLeave.current = false;
      playSound('join');
      setPartnerId(partnerId);
      setPartnerName(partnerName);
      sessionStorage.setItem('partnerId', partnerId);
      sessionStorage.setItem('partnerName', partnerName);
      toast.success(`✅ Connected with ${partnerName}`);
      setMessages([]);
      setChatState('chatting');
      trackSessionStart();
    };

    const handlePartnerLeft = () => {
      if (leftManually.current) {
        leftManually.current = false;
        return;
      }
      playSound('leave');
      toast.info('Your partner has left the chat. Click "Next" to find a new buddy.');
      setMessages([
        { text: 'Partner has left the chat. Click "Next" to find a new buddy.', from: 'system' },
      ]);
      setChatState('noBuddy');
      setPartnerId(null);
      setPartnerName('');
      trackSessionEnd();
      sessionStorage.removeItem('partnerId');
      sessionStorage.removeItem('partnerName');
      hasHandledLeave.current = false;
      clearTimeout(searchTimeout.current);
    };
    const handleChatMessage = (msg) => {
      setMessages((msgs) =>
        msgs.length && msgs[msgs.length - 1]?.timestamp === msg.timestamp ? msgs : [...msgs, msg]
      );
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
    socket.on('partner_found', handlePartnerFound);

    socket.on('partner_left', handlePartnerLeft);
    socket.on('chatMessage', handleChatMessage);
    socket.on('no_buddy_found', () => {
      notifyNoBuddy();
      socket.emit('leave_chat', { userId });
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

    return () => {
      socket.off('partner_found', handlePartnerFound);
      socket.off('partner_disconnected');
      socket.off('partner_left', handlePartnerLeft);
      socket.off('chatMessage', handleChatMessage);
      socket.off('no_buddy_found');
      socket.off('partner_idle');
      socket.off('partner_active');
      socket.off('suspended', handleSuspended);
      socket.off('report_received', handleReportReceived);
      socket.off('report_warning', handleReportWarning);
      socket.off('next_ack', handleNextAck);
      clearTimeout(searchTimeout.current);
    };
  }, [socket, isConnected, userId, userName, deviceId]);

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

  // Handle browser tab visibility changes. If the user leaves the tab or
  // minimizes the browser for more than 30 seconds, end the chat session.
  useEffect(() => {
    if (!socket || !userId) return;
    let hideTimer;
    const handleVisibility = () => {
      if (document.hidden) {
        hideTimer = setTimeout(() => {
          if (socket) {
            socket.emit('leave_chat', { userId });
            socket.disconnect();
          }
          hasHandledLeave.current = true;
          trackSessionEnd();
          sessionStorage.clear();
          setChatState('idle');
          setPartnerId(null);
          setMessages([]);
          navigate('/', { replace: true });
        }, 30000);
      } else {
        clearTimeout(hideTimer);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      clearTimeout(hideTimer);
    };
  }, [socket, userId, navigate, trackSessionEnd]);

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

  useExitProtection({
    enabled: chatState === 'chatting',
    onBack: () => {
      if (socket && userId && partnerId) {
        socket.emit('leave_chat', { userId });
      }
      if (socket) {
        socket.off('chat_message');
        socket.off('chatMessage');
      }
      hasHandledLeave.current = true;
      trackSessionEnd();
      sessionStorage.clear();
      setChatState('idle');
      setPartnerId(null);
      setMessages([]);
      navigate('/', { replace: true });
    },
    onRefresh: () => {
      if (socket && userId && partnerId) {
        socket.emit('leave_chat', { userId });
      }
      if (socket) socket.disconnect();
      hasHandledLeave.current = true;
      trackSessionEnd();
      sessionStorage.clear();
    },
    showExitConfirmToast: () => showMobileExitToast(() => {
      if (socket && userId && partnerId) {
        socket.emit('leave_chat', { userId });
      }
      if (socket) {
        socket.off('chat_message');
        socket.off('chatMessage');
      }
      hasHandledLeave.current = true;
      trackSessionEnd();
      sessionStorage.clear();
      setChatState('idle');
      setPartnerId(null);
      setMessages([]);
      navigate('/', { replace: true });
    }),
  });

  useEffect(() => {
    return () => {
      if (!hasHandledLeave.current && socket && userIdRef.current && partnerIdRef.current) {
        socket.emit('leave_chat', { userId: userIdRef.current });

        trackSessionEnd();
        sessionStorage.clear();
        if (socket) socket.disconnect();
      }
    };
  }, [socket]);

  return (
    <div className="w-full flex justify-center bg-[#ece5dd] h-[100dvh] overflow-y-auto">
      <div className="w-full h-full flex flex-col">
        <div className="flex flex-col w-full h-full max-w-full sm:max-w-[450px] md:max-w-[600px] lg:max-w-[700px] xl:max-w-[900px] sm:rounded-2xl bg-[#f8f9fa] shadow-2xl overflow-hidden relative text-[#222e35] font-[system-ui,sans-serif] text-base border sm:border-0">
          {/* Header */}
          {/* Header */}
         <div className="h-10 shrink-0 flex items-center justify-between px-4 py-2 bg-white shadow-sm border-b border-[#f1f1f1] z-20">
            <span className="font-semibold text-2xl text-[#111] tracking-wide">
              {partnerName ? partnerName : "Waiting..."}
            </span>

         
          </div>
          {/* Chat area */}
          <div
            className="flex-1 flex flex-col overflow-hidden relative bg-white"
            style={{
              // backgroundImage: `url(${doodleBg})`,
              backgroundRepeat: 'no-repeat',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}

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
                    <SpeechBubble isSender={msg.userId === userId}>
                      {msg.message}
                    </SpeechBubble>
                  )}
                  {msg.from === 'system' && (
                    <div className="italic text-sm text-gray-500">{msg.text}</div>
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
              />
              {!keyboardVisible && (
                <div className="mt-2">
                  <ChatFooter handleNext={handleNext} handleReport={handleReport} />
                </div>
              )}
            </div>
          </div>

          <ToastContainer
            position="bottom-right"
            autoClose={3000}
            theme="light"
            closeOnClick
            pauseOnHover
          />
        </div>
      </div>
    </div>
  );
};
export default ChatBox;
