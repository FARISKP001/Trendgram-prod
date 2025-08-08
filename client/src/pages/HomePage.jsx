import React, { useState, useRef, useEffect } from 'react';
import logo from '../assets/tg_logo.png';
import CaptchaModal from '../components/CaptchaModal.jsx';
import CookieConsent from '../components/CookieConsent';
import { getCookie, setCookie } from "../utils/cookies.js";
import AgeConfirmation from '../components/AgeConfirmation.jsx';
import { useNavigate } from 'react-router-dom';
import useSocketContext from '../context/useSocketContext';
import {
  ArrowRightIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/solid';
import { usePageView } from '../hooks/usePageView';
import sendAnalyticsEvent from '../utils/analytics.js';
import { validateText } from '../utils/textFilters';

const HomePage = () => {
  usePageView('HomePage');
  const timeoutRef = useRef(null);
  const [name, setName] = useState('');
  const [matching, setMatching] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  const [deviceId, setDeviceId] = useState(null);
  const [suspendedUntil, setSuspendedUntil] = useState(() => {
    const stored = localStorage.getItem('suspendedUntil');
    return stored ? parseInt(stored, 10) : null;
  });
  const [showCaptcha, setShowCaptcha] = useState(false);
  // Captcha is considered verified when the cooldown cookie exists
  const [captchaVerified, setCaptchaVerified] = useState(() => !!getCookie('captchaCooldown'));
  const [ageConfirmed, setAgeConfirmed] = useState(() => localStorage.getItem('ageConfirmed') === 'true');
  const [showAgeModal, setShowAgeModal] = useState(false);
  const pendingAction = useRef(null);
  const siteKey = import.meta.env.VITE_CF_SITE_KEY;

  const navigate = useNavigate();
  const { socket, isConnected } = useSocketContext();

  const storedUserId = localStorage.getItem('userId') || crypto.randomUUID();
  localStorage.setItem('userId', storedUserId);
  const userId = useRef(storedUserId);

  useEffect(() => {
    const init = async () => {
      const FingerprintJS = await import('@fingerprintjs/fingerprintjs');
      const fp = await FingerprintJS.load();
      const res = await fp.get();
      setDeviceId(res.visitorId);
    };
    init();
  }, []);

  useEffect(() => {
    if (suspendedUntil && Date.now() >= suspendedUntil) {
      setSuspendedUntil(null);
      localStorage.removeItem('suspendedUntil');
      setError('');
      return;
    }
    if (suspendedUntil) {
      setError('You are suspended. Please try again later.');
      const timeout = setTimeout(() => {
        setSuspendedUntil(null);
        localStorage.removeItem('suspendedUntil');
        setError('');
      }, suspendedUntil - Date.now());
      return () => clearTimeout(timeout);
    }
  }, [suspendedUntil]);

  useEffect(() => {
    if (socket && !socket.connected) {
      socket.connect();
    }
  }, [socket]);

  // 📡 Register Socket
  useEffect(() => {
    if (socket && isConnected && userId.current && deviceId) {
      socket.emit('register_user', {
        userId: userId.current,
        deviceId,
        userName: name || 'Guest',
      });
    }
  }, [socket?.id, isConnected, deviceId, name]);

  // 🧹 Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // 🧼 UX: Clear matching status if name is cleared mid-search
  useEffect(() => {
    if (!name && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      setMatching(false);
      setStatus('');
    }
  }, [name]);

  // 👥 Handle Matching Events
  useEffect(() => {
    if (!socket || !isConnected) return;

    const handleNoBuddyFound = () => {
      clearTimeout(timeoutRef.current);
      setMatching(false);
      setStatus('❌ No partner found. Please try again.');
    };

    const handlePartnerFound = ({ partnerId, partnerName }) => {
      console.log("PARTNER FOUND PAYLOAD:", { partnerId, partnerName });
      clearTimeout(timeoutRef.current);
      navigate('/chatbox', {
        state: {
          userId: userId.current,
          partnerId,
          userName: name,
          partnerName,      // <--- Add this!
        },
      });
    };

    const handleSuspended = ({ message, expiresAt }) => {
      clearTimeout(timeoutRef.current);
      setMatching(false);
      setStatus('');
      setError(message);
      if (expiresAt) {
        setSuspendedUntil(expiresAt);
        localStorage.setItem('suspendedUntil', expiresAt);
      }
    };

    socket.on('no_buddy_found', handleNoBuddyFound);
    socket.on('partner_found', handlePartnerFound);
    socket.on('suspended', handleSuspended);

    return () => {
      socket.off('no_buddy_found', handleNoBuddyFound);
      socket.off('partner_found', handlePartnerFound);
      socket.off('suspended', handleSuspended);
    };
  }, [socket, isConnected, name, navigate, suspendedUntil]);

  useEffect(() => {
    if (!socket) return;
    const handleCaptcha = () => {
      // Skip showing captcha if cooldown cookie exists
      if (getCookie('captchaCooldown')) {
        setCaptchaVerified(true);
        if (pendingAction.current) {
          const fn = pendingAction.current;
          pendingAction.current = null;
          fn();
        }
        return;
      }
      setCaptchaVerified(false);
      setShowCaptcha(true);
    };
    socket.on('captcha_required', handleCaptcha);
    return () => socket.off('captcha_required', handleCaptcha);
  }, [socket]);

  const ensureCaptcha = (action) => {
    // Refresh verification state from cookie each call
    const hasCookie = !!getCookie('captchaCooldown');
    if (!hasCookie) {
      setCaptchaVerified(false);
      pendingAction.current = action;
      setShowCaptcha(true);
    } else {
      setCaptchaVerified(true);
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
        // Set cooldown cookie for one minute
        setCookie('captchaCooldown', 'true', { minutes: 1 });
        setCaptchaVerified(true);
        setShowCaptcha(false);
        socket.emit('register_user', {
          userId: userId.current,
          deviceId,
          userName: name || 'Guest',
        });
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

  const handleNameChange = (e) => {
    const val = e.target.value;
    setName(val);
    if (!val) return setError('');
    const validation = validateText(val);
    setError(validation.valid ? '' : 'Please follow community guidlines.');
  };

  const startMatch = () => {
    if (!deviceId) {
      setError('Loading device identity...');
      return;
    }

    if (suspendedUntil && Date.now() < suspendedUntil) {
      setError('You are suspended temperorly. Please be polite in next time.');
      return;
    }

    // Clear any previous timeout
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const validation = validateText(name);
    if (!validation.valid) {
      setError('Please enter a valid name.');
      return;
    }

    if (!socket || !isConnected) {
      setError('Socket not connected.');
      return;
    }

    ensureCaptcha(() => {
      setMatching(true);
      setStatus('');
      setError('');
      socket.emit('find_new_buddy', {
        userId: userId.current,
        userName: name,
        deviceId,
      });
      sendAnalyticsEvent('user_connected', {
        user_id: userId.current,
        user_name: name,
        timestamp: new Date().toISOString(),
      });

      timeoutRef.current = setTimeout(() => {
        setMatching(false);
        setStatus('No partner is available');
      }, 60 * 1000); // 1 minute
    });
  };

  // 🔍 Start matching
  const handleFindMatch = (e) => {
    e.preventDefault();

    if (!ageConfirmed) {
      setShowAgeModal(true);
      return;
    }

    startMatch();
  };

  const handleAgeConfirm = () => {
    localStorage.setItem('ageConfirmed', 'true');
    setAgeConfirmed(true);
    setShowAgeModal(false);
    startMatch();
  };

  const handleAgeCancel = () => {
    setError('You should be minimum 18 to enter to the website.');
    setMatching(false);
    setShowAgeModal(false);
  };

  return (
    <div className="relative min-h-screen overflow-hidden sm:overflow-auto flex flex-col px-4 pt-0 pb-[calc(env(safe-area-inset-bottom,0px)+32px)] bg-white dark:bg-[#0b1120] text-gray-900 dark:text-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-[#ffdb58] shadow-sm">
        <div className="flex items-center h-12 sm:h-14 px-3 sm:px-4">
          <img
            src={logo}
            alt="TrendGram"
            className="w-auto object-contain shrink-0"
            style={{ height: 28 }}
          />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 bg-white">
        <div className="min-h-[calc(100svh-3rem)] sm:min-h-[calc(100svh-3.5rem)] flex items-center justify-center px-4">
          <div className="w-full max-w-[520px] space-y-4">
            <form onSubmit={handleFindMatch}>
              <div className="flex items-center gap-x-4 bg-gray-200 dark:bg-[#111c2f] rounded-full px-4 shadow-md mx-5 sm:mx-0">
                <input
                  className="flex-1 bg-transparent text-gray-900 dark:text-gray-50 placeholder-gray-500 dark:placeholder-gray-400 outline-none rounded-full border-2 border-[#8fbc8f] h-[40px] text-lg px-3"
                  type="text"
                  value={name}
                  onChange={handleNameChange}
                  placeholder="Enter your name"
                  required
                  maxLength={10}
                />
                <button
                  type="submit"
                  disabled={matching || !name || (suspendedUntil && Date.now() < suspendedUntil)}
                  className="flex items-center justify-center w-10 h-10 min-w-[40px] min-h-[40px] rounded-full bg-sky-300 hover:bg-sky-400 transition-transform hover:scale-105 disabled:cursor-not-allowed border-2 border-[#8fbc8f]"
                >
                  {matching ? (
                    <ArrowPathIcon className="w-5 h-5 text-[#da9100] animate-spin" />
                  ) : (
                    <ArrowRightIcon className="w-5 h-5 text-gray-900 dark:text-white" />
                  )}
                </button>
              </div>
            </form>

            {/* Age consent */}
            {showAgeModal && (
              <AgeConfirmation onConfirm={handleAgeConfirm} onCancel={handleAgeCancel} />
            )}

            {/* Cookie consent with space */}
           {!getCookie("cookieConsentGiven") && <CookieConsent />}

          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="text-center text-sm mt-8 px-2 text-[#4169e1]">
        <p>
          By continuing to use TrendGram, you agree to our{' '}
          <a
            className="underline text-[#00bfff] hover:text-[#00bfff]"
            href="/cookie-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Cookie Policy
          </a>
          <span className="text-[#4169e1]">·</span>
          <a
            className="underline text-[#00bfff] hover:text-[#00bfff]"
            href="/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Privacy Policy
          </a>
          , and{' '}
          <a
            className="underline text-[#00bfff] hover:text-[#00bfff]"
            href="/terms-and-conditions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Terms & Conditions
          </a>
          {' '}— crafted to keep your experience smooth, secure, and transparent.
        </p>
        <p className="mt-2 pb-[calc(env(safe-area-inset-bottom,0px)+20px)]">© 2025 TrendGram</p>
      </footer>
      <CaptchaModal visible={showCaptcha} onSuccess={handleCaptchaSuccess} siteKey={siteKey} />
      <div className="block sm:hidden h-[calc(env(safe-area-inset-bottom,0px)+24px)]" />
    </div>
  );
};
export default HomePage;