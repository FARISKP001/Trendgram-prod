import React, { useState, useRef, useEffect } from 'react';
import WebbitLogo from '../components/WebbitLogo.jsx';
import CaptchaModal from '../components/CaptchaModal.jsx';
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
  const [showCookieBar, setShowCookieBar] = useState(() => !localStorage.getItem('cookieAccepted'));
  const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  const [deviceId, setDeviceId] = useState(null);
  const [suspendedUntil, setSuspendedUntil] = useState(() => {
    const stored = localStorage.getItem('suspendedUntil');
    return stored ? parseInt(stored, 10) : null;
  });
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [captchaVerified, setCaptchaVerified] = useState(false);
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

  // 📡 Register Socket
  useEffect(() => {
    if (socket && isConnected && userId.current && deviceId) {
      socket.emit('register_user', { userId: userId.current, deviceId });
    }
  }, [socket?.id, isConnected, deviceId]);

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
      setCaptchaVerified(false);
      setShowCaptcha(true);
    };
    socket.on('captcha_required', handleCaptcha);
    return () => socket.off('captcha_required', handleCaptcha);
  }, [socket]);

  // 🍪 Dismiss Cookie Bar
  const handleCookieDismiss = () => {
    localStorage.setItem('cookieAccepted', 'true');
    setShowCookieBar(false);
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
        socket.emit('register_user', { userId: userId.current, deviceId });
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

  // 🔍 Start matching
  const handleFindMatch = (e) => {
    e.preventDefault();

    const ageConfirmed = window.confirm('Are you 18 years old or above?');
    if (!ageConfirmed) {
      setError('You should be minimum 18 to enter to the website.');
      setMatching(false);
      return;
    }

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

  return (
    <div className="relative min-h-screen flex flex-col justify-between py-8 px-4 bg-blue-100 dark:bg-[#0b1120] text-gray-900 dark:text-gray-50">
      {/* Header */}
      <div
        className="flex items-center justify-start w-full mb-2 px-4 py-2 bg-white dark:bg-[#2a2f32] shadow-md rounded-2xl relative overflow-visible"
        style={{ minHeight: 64 }}
      >
        <WebbitLogo size={130} style={{ marginTop: '-32px', marginBottom: '-32px' }} />
      </div>

      <main className="flex flex-col items-center">
        <form onSubmit={handleFindMatch} className="flex justify-center">
          <div className="flex items-center justify-between bg-gray-200 dark:bg-[#111c2f] rounded-full py-2.5 px-4 max-h-16 shadow-md max-w-[420px] w-full mx-auto my-8">
            <input
              className="bg-transparent text-gray-900 dark:text-gray-50 placeholder-gray-500 dark:placeholder-gray-400 outline-none text-sm flex-1 px-4 py-2 rounded-full min-w-0 border-2 border-sky-400"
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
              className="flex items-center justify-center w-9 h-9 min-w-[36px] min-h-[36px] rounded-full bg-sky-300 hover:bg-sky-400 transition-colors transform hover:scale-105 disabled:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 border-2 border-sky-500"
            >
              {matching ? (
                <ArrowPathIcon className="w-4 h-4 text-gray-900 dark:text-white animate-spin" />
              ) : (
                <ArrowRightIcon className="w-4 h-4 text-gray-900 dark:text-white" />
              )}
            </button>
          </div>
        </form>

        {status && <p className="mt-4 text-green-600 dark:text-emerald-400">{status}</p>}
        {error && <p className="mt-4 text-red-600 dark:text-red-400">{error}</p>}
      </main>

      <footer className="text-center text-sm text-gray-500 dark:text-gray-400 mt-12 mb-2">
        <p>We use cookies to improve your experience. By browsing, you agree to this.</p>
        <ul className="flex justify-center gap-8 mt-2 list-none p-0">
          <li><a className="text-green-800 underline hover:text-emerald-500 dark:text-emerald-400" href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
          <li><a className="text-green-800 underline hover:text-emerald-500 dark:text-emerald-400" href="/cookie-policy" target="_blank" rel="noopener noreferrer">Cookie Policy</a></li>
          <li><a className="text-green-800 underline hover:text-emerald-500 dark:text-emerald-400" href="/terms-and-conditions" target="_blank" rel="noopener noreferrer">Terms & Conditions</a></li>
        </ul>
        <p className="mt-2">© 2025 TrendGram</p>
      </footer>
      <CaptchaModal visible={showCaptcha} onSuccess={handleCaptchaSuccess} siteKey={siteKey} />
    </div>
  );
};

export default HomePage;