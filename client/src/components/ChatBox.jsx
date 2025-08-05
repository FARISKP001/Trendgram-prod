import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useClickAway } from 'react-use';
const EmojiPicker = lazy(() => import('emoji-picker-react'));
import { useLocation, useNavigate } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import useSocketContext from '../context/useSocketContext';
import joinSound from '../assets/join.mp3';
import leaveSound from '../assets/leave.mp3';
import doodleBg from '../assets/doodle-bg.png';
import useExitProtection from '../hooks/useExitProtection';
import { FixedSizeList as List } from 'react-window';
import useChatAnalytics from '../hooks/useChatAnalytics';
import showConfirmToast from '../utils/showConfirmToast';
import { sanitizeMessage, validateText } from '../utils/textFilters';
import WebbitLogo from './WebbitLogo';
import SpeechBubble from './SpeechBubble';
import ChatInput from './ChatInput';
import ChatFooter from './ChatFooter';
import CaptchaModal from './CaptchaModal';

// Modern Apple Photos style palette icon (SVG)
const ModernPaletteIcon = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 40 40">
    <circle cx="20" cy="10" r="8" fill="#FF7C2B" fillOpacity="0.90" />
    <circle cx="31" cy="17" r="8" fill="#97DE00" fillOpacity="0.90" />
    <circle cx="26" cy="30" r="8" fill="#17C4FF" fillOpacity="0.90" />
    <circle cx="14" cy="30" r="8" fill="#FF55B2" fillOpacity="0.90" />
    <circle cx="9" cy="17" r="8" fill="#FFE64D" fillOpacity="0.90" />
    <circle cx="20" cy="21" r="7" fill="#FFF" fillOpacity="0.9" />
  </svg>
);

// Limit the palette to six visible options arranged 3×2
const colorOptions = [
  '#f0f8ff', // Alice blue
  '#fff0f5', // Lavender Blush
  '#b0e0e6', // Powder Blue
  '#ccff00', // Electric lime
  '#fbceb1', // Apricot
  '#f5deb3', // Wheat
];

const showMobileExitToast = (onConfirm) => {
  showConfirmToast({
    message: "⚠️ You're about to leave the chat.\nDo you want to exit?",
    onConfirm,
    toastId: 'mobile-exit-confirm',
  });
};

const toCircleFont = (text) =>

  text.split('').map((c) => {
    const code = c.toUpperCase().charCodeAt(0);
    return code >= 65 && code <= 90 ? String.fromCharCode(0x24b6 + (code - 65)) : c;
  }).join('');

const ChatBox = () => {
  const { socket, isConnected } = useSocketContext();
  const location = useLocation();
  const navigate = useNavigate();
  const leftManually = useRef(false);
  const [deviceId, setDeviceId] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState('Guest');
  const [partnerId, setPartnerId] = useState(null);
  const [partnerName, setPartnerName] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatState, setChatState] = useState('idle');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiPickerLoaded, setEmojiPickerLoaded] = useState(false);
  const [inputError, setInputError] = useState('');
  const [bgColor, setBgColor] = useState(() => sessionStorage.getItem('chatBgColor') || '#ffffff');
  const [showColorPicker, setShowColorPicker] = useState(false);
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
  const nextClicksRef = useRef([]);
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const pendingAction = useRef(null);
  const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  const siteKey = import.meta.env.VITE_CF_SITE_KEY;

  const {
    trackSessionStart,
    trackMessageSent,
    trackSessionEnd,
    trackUserReported,
  } = useChatAnalytics({ userId, partnerId, userName, messages });

  // Preload Emoji Picker after mount
  useEffect(() => {
    import('emoji-picker-react').then(() => setEmojiPickerLoaded(true));
  }, []);

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
    if (!finalId) return navigate('/', { replace: true });
    setUserId(finalId);
    setUserName(nameFromState || storedName || 'Guest');
  }, [location.state, navigate]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { partnerIdRef.current = partnerId; }, [partnerId]);

  useEffect(() => {
    if (!socket) return;
    const handleCaptcha = () => {
      setCaptchaVerified(false);
      setShowCaptcha(true);
    };
    socket.on('captcha_required', handleCaptcha);
    return () => socket.off('captcha_required', handleCaptcha);
  }, [socket]);

  const playSound = (type) => new Audio(type === 'join' ? joinSound : leaveSound).play();

  // Register user (always send userName)
  const registerUser = () => {
    if (!socket?.connected || !userId || !deviceId) return;
    socket.emit('register_user', { userId, deviceId });
    sessionStorage.setItem('userId', userId);
    sessionStorage.setItem('userName', userName);
  };

  const ensureCaptcha = (action) => {
    if (!captchaVerified) {
      pendingAction.current = action;
      setShowCaptcha(true);
    } else {
      action();
    }
  };

  const handleCaptchaSuccess = async (token) => {
    if (!deviceId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/verify-captcha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, deviceId }),
      });
      const data = await res.json();
      if (data.success) {
        setCaptchaVerified(true);
        setShowCaptcha(false);
        socket.emit('register_user', { userId, deviceId });
        if (pendingAction.current) {
          const fn = pendingAction.current;
          pendingAction.current = null;
          fn();
        }
      }
    } catch (err) {
      console.error('Captcha verification failed', err);
    }
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

  const handleEmojiClick = (emojiData) => {
    setInput((prev) => prev + emojiData.emoji);
    inputRef.current?.focus();
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
    setShowEmojiPicker(false);
  };

  useEffect(() => {
    if (showEmojiPicker) {
      const interval = setInterval(() => {
        const picker = document.querySelector('emoji-picker');
        if (!picker || !picker.shadowRoot) return;
        picker.style.display = 'block';
        picker.style.width = '100%';
        picker.style.height = '100%';
        const input = picker.shadowRoot.querySelector('input');
        if (input) {
          input.placeholder = 'Search emojis';
          input.style.paddingLeft = '2.4em';
          input.style.height = '36px';
          input.style.margin = '8px';
          input.style.borderRadius = '20px';
          input.style.border = '1px solid #ccc';
        }
        const icon = picker.shadowRoot.querySelector('.epr-search-icon-wrapper');
        if (icon) {
          icon.style.left = '1em';
          icon.style.top = '50%';
          icon.style.transform = 'translateY(-50%)';
        }
        const body = picker.shadowRoot.querySelector('.epr-body');
        if (body) {
          body.style.overflowY = 'auto';
          body.style.height = '100%';
        }
        clearInterval(interval);
      }, 100);
      return () => clearInterval(interval);
    }
  }, [showEmojiPicker]);

  const handleNext = () => {
    if (chatState === 'searching' || hasHandledLeave.current) return;
    if (!socket?.connected) return toast.error('Unable to connect to server. Please refresh.');

    // Rate limit "Next" clicks: captcha after 3 clicks within a minute
    const now = Date.now();
    nextClicksRef.current = nextClicksRef.current.filter((ts) => now - ts < 60000);
    nextClicksRef.current.push(now);

    const performNext = () => {
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
        setChatState('noBuddy');
        socket.emit('leave_chat', { userId });
      }, 60000);
    };

    if (nextClicksRef.current.length >= 3) {
      ensureCaptcha(() => {
        nextClicksRef.current = [];
        performNext();
      });
    } else {
      performNext();
    }
  };

  const handleNewBuddy = () => {
    if (chatState === 'chatting' || partnerId || !deviceId) return;
    if (!socket?.connected) return toast.error('Unable to connect to server.');
    ensureCaptcha(() => {
      hasHandledLeave.current = false;
      setChatState('searching');
      setPartnerId(null);
      setMessages([]);
      sessionStorage.clear();
      socket.emit('find_new_buddy', { userId, userName, deviceId });
      clearTimeout(searchTimeout.current);
      searchTimeout.current = setTimeout(() => {
        setChatState('noBuddy');
        socket.emit('leave_chat', { userId });
      }, 60000);
    });
  };

  const handleReport = () => {
    if (!socket || !partnerId || !deviceId) return;
    ensureCaptcha(() => {
      const lastMessages = messages.slice(-10);
      socket.emit('report_user', {
        reporterId: userId,
        reporterDeviceId: deviceId,
        reportedUserId: partnerId,
        messages: lastMessages,
      });
      trackUserReported();
    });
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
      console.log("PARTNER FOUND PAYLOAD:", { partnerId, partnerName });
      clearTimeout(searchTimeout.current);
      hasHandledLeave.current = false;
      playSound('join');
      setPartnerId(partnerId);
      setPartnerName(partnerName);
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
        setChatState('noBuddy');
        socket.emit('leave_chat', { userId });
      }, 60000);
      toast.success('Searching for a new buddy...');
    };
    socket.on('partner_found', handlePartnerFound);
    socket.on('partner_left', handlePartnerLeft);
    socket.on('chatMessage', handleChatMessage);
    socket.on('no_buddy_found', () => setChatState('noBuddy'));
    socket.on('partner_idle', () =>
      toast.info('⚠️ Your partner seems idle.', { toastId: 'partner-idle' })
    );
    socket.on('partner_active', () => toast.dismiss('partner-idle'));
    socket.on('suspended', handleSuspended);
    socket.on('report_received', handleReportReceived);
    socket.on('report_warning', handleReportWarning);
    socket.on('next_ack', handleNextAck);

    return () => {
      socket.off('partner_found', handlePartnerFound);
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
      hasHandledLeave.current = true;
      trackSessionEnd();
      sessionStorage.clear();
    },
    showExitConfirmToast: () => showMobileExitToast(() => {
      if (socket && userId && partnerId) {
        socket.emit('leave_chat', { userId });

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
      }
    };
  }, [socket]);

  // For popover click-away
  const colorPopoverRef = useRef(null);
  useClickAway(colorPopoverRef, () => setShowColorPicker(false));

  return (
    <div className="w-full flex justify-center bg-[#ece5dd] dark:bg-gray-900 transition-colors duration-300 min-h-screen">
      <div className="
      flex flex-col
      w-full h-[100dvh]
      max-w-full sm:max-w-[450px] md:max-w-[600px] lg:max-w-[700px] xl:max-w-[900px]
      sm:rounded-2xl
      bg-[#f8f9fa] dark:bg-[#23272b]
      shadow-2xl overflow-x-hidden
      relative
      text-[#222e35] dark:text-gray-100
      font-[system-ui,sans-serif] text-base
      border sm:border-0
    ">
        {/* Header */}
        <div
          className="sticky top-0 z-20 relative flex items-center px-6 py-3 bg-white dark:bg-[#2a2f32] shadow-sm border-b border-[#f1f1f1] flex-shrink-0"
          style={{ height: '60px' }}
        >
          <WebbitLogo size={52} style={{ marginTop: 0, marginBottom: 0 }} />
          {/* Color Icon at far left */}
          <div className="ml-3 mr-6 relative flex items-center">
            <button
              onClick={() => setShowColorPicker((prev) => !prev)}
              className="p-1 rounded-full bg-white dark:bg-[#2a2f32] hover:bg-gray-200 dark:hover:bg-gray-700 transition"
              title="Change chat background"
              aria-label="Change background color"
              type="button"
            >
              <ModernPaletteIcon size={28} />
            </button>
            {showColorPicker && (
              <div
                ref={colorPopoverRef}
                className="absolute left-0 top-full bg-white dark:bg-gray-800 rounded-xl shadow-lg border-2 border-indigo-600 p-3 z-30 grid grid-cols-2 grid-rows-3 gap-2 min-w-[100px] mt-2"
              >
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    className="w-9 h-9 rounded-full outline-none focus:ring-2 focus:ring-cyan-400 transition hover:scale-110 flex items-center justify-center"
                    style={{
                      background: color,
                      boxShadow: bgColor === color ? '0 0 0 2.5px #17C4FF' : '0 2px 8px 0 #0001',
                      borderColor: bgColor === color ? '#17C4FF' : 'transparent',
                      borderWidth: bgColor === color ? '2px' : '0px',
                      borderStyle: 'solid',
                    }}
                    aria-label={`Change background to ${color}`}
                    onClick={() => {
                      setBgColor(color);
                      sessionStorage.setItem('chatBgColor', color);
                      setShowColorPicker(false);
                    }}
                  >
                    {bgColor === color && (
                      <span style={{ color: '#222', fontSize: '1.2rem', fontWeight: 900, lineHeight: 1 }}>
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Partner Name */}
          <span className="ml-4 font-semibold text-2xl dark:text-white text-[#111] tracking-wide">
            {partnerName ? toCircleFont(partnerName) : 'Ⓦⓐⓘⓣⓘⓝⓖ...'}
          </span>
        </div>

        {/* Main Chat Body */}
        <div className="flex-1 flex flex-col bg-repeat relative no-scrollbar"
          style={{
            backgroundImage: `url(${doodleBg})`,
            backgroundRepeat: 'repeat',
            backgroundSize: '400px',
            backgroundColor: bgColor,
            opacity: 1,
            transition: 'background-color 0.3s'
          }}
        >
          {/* Messages Area: Only this part scrolls */}
          <div className="flex-1 overflow-y-auto px-2 py-4" ref={listContainerRef}>
            <List
              height={listHeight}
              itemCount={messages.length}
              itemSize={60}  // Set lower for more compact message bubbles
              width={'100%'}
              ref={messageListRef}
            >
              {({ index, style }) => {
                const msg = messages[index];
                return (
                  <div
                    style={style}
                    key={msg.timestamp || index}
                    className={
                      msg.from === 'system'
                        ? 'flex justify-center my-2'
                        : msg.userId === userId
                          ? 'flex justify-end'
                          : 'flex justify-start'
                    }
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
                );
              }}
            </List>
          </div>
          {/* Input and Footer */}
          <div className="sticky bottom-0 left-0 right-0 bg-inherit z-10">
            <ChatInput
              input={input}
              inputError={inputError}
              chatState={chatState}
              handleInputChange={handleInputChange}
              handleSend={handleSend}
              showEmojiPicker={showEmojiPicker}
              setShowEmojiPicker={setShowEmojiPicker}
              inputRef={inputRef}
            />
            <ChatFooter handleNext={handleNext} handleReport={handleReport} />
          </div>

          {/* Emoji Picker Drawer: WhatsApp Style */}
          {showEmojiPicker && (
            <div
              className={`
                emoji-picker-modal fixed left-0 w-full z-50
                bg-white dark:bg-gray-800 shadow-2xl
                rounded-t-2xl
                transition-transform duration-300
                bottom-0 translate-y-0
                flex justify-center
                md:absolute md:rounded-2xl md:w-[340px] md:left-1/2 md:-translate-x-1/2 md:bottom-24
                md:opacity-100 pointer-events-auto
              `}
              style={{
                height: '320px',
                maxHeight: '80vh',
                width: '100%',
                boxShadow: '0 4px 24px rgba(0,0,0,0.16)',
                ...(window.innerWidth >= 768 && {
                  width: '340px',
                  height: '370px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                })
              }}
            >
              <Suspense fallback={<div className="p-6 text-center">Loading…</div>}>
                <EmojiPicker
                  onEmojiClick={handleEmojiClick}
                  width="100%"
                  height={window.innerWidth >= 768 ? "370px" : "320px"}
                  lazyLoadEmojis
                  skinTonesDisabled
                />
              </Suspense>
            </div>
          )}

          {/* Toast Notifications */}
          <ToastContainer position="bottom-center" />
          <CaptchaModal
            visible={showCaptcha}
            onSuccess={handleCaptchaSuccess}
            siteKey={siteKey}
          />
        </div>
      </div>
    </div>
  );
};
export default ChatBox;