import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSocketContext from '../context/useSocketContext';
import { ArrowRightIcon, ArrowPathIcon } from '@heroicons/react/24/solid';
import { usePageView } from '../hooks/usePageView';
import sendAnalyticsEvent from '../utils/analytics.js';
import { validateText } from '../utils/textFilters';
import FingerprintJS from '@fingerprintjs/fingerprintjs';

const HomePage = () => {
  usePageView('HomePage');
  const timeoutRef = useRef(null);
  const [name, setName] = useState('');
  const [matching, setMatching] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('darkMode') === 'true');
  const [showCookieBar, setShowCookieBar] = useState(() => !localStorage.getItem('cookieAccepted'));
  const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  const [deviceId, setDeviceId] = useState(null);

  const navigate = useNavigate();
  const { socket, isConnected } = useSocketContext();

  const storedUserId = localStorage.getItem('userId') || crypto.randomUUID();
  localStorage.setItem('userId', storedUserId);
  const userId = useRef(storedUserId);

  useEffect(() => {
    FingerprintJS.load().then(fp => fp.get().then(res => setDeviceId(res.visitorId)));
  }, []);

  // 🌗 Handle Dark Mode
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

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

    socket.on('no_buddy_found', handleNoBuddyFound);
    socket.on('partner_found', handlePartnerFound);

    return () => {
      socket.off('no_buddy_found', handleNoBuddyFound);
      socket.off('partner_found', handlePartnerFound);
    };
  }, [socket, isConnected, name, navigate]);

  // 🍪 Dismiss Cookie Bar
  const handleCookieDismiss = () => {
    localStorage.setItem('cookieAccepted', 'true');
    setShowCookieBar(false);
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

    if (!deviceId) {
      setError('Loading device identity...');
      return;
    }

    // Clear any previous timeout
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setMatching(true);
    setStatus('');
    setError('');

    const validation = validateText(name);
    if (!validation.valid) {
      setError('Please enter a valid name.');
      setMatching(false);
      return;
    }

    if (!socket || !isConnected) {
      setError('Socket not connected.');
      setMatching(false);
      return;
    }

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
  };

  return (
    <div className="relative min-h-screen flex flex-col justify-between py-8 px-4 bg-gray-100 dark:bg-[#0b1120] text-gray-900 dark:text-gray-50">
      <header className="mb-8 text-[2.5rem] font-extrabold text-purple-600 dark:text-white">TrendGram</header>


      <button
        onClick={() => setDarkMode((prev) => !prev)}
        className="absolute top-4 right-4 text-xl cursor-pointer bg-transparent border-0"
      >
        {darkMode ? '☀️' : '🌙'}
      </button>

      <main className="flex flex-col items-center">
        <form onSubmit={handleFindMatch} className="flex justify-center">
          <div className="flex items-center justify-between bg-gray-200 dark:bg-[#111c2f] rounded-full py-1.5 px-4 max-h-14 shadow-md max-w-[420px] w-full mx-auto my-8">
            <input
              className="bg-transparent text-gray-900 dark:text-gray-50 placeholder-gray-500 dark:placeholder-gray-400 border-0 outline-none text-sm flex-1 px-3 py-1 rounded-full min-w-0"
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder="Enter your name"
              required
              maxLength={10}
            />
            <button
              type="submit"
              disabled={matching || !name}
              className="flex items-center justify-center w-9 h-9 min-w-[36px] min-h-[36px] rounded-full bg-sky-300 hover:bg-sky-400 transition-colors transform hover:scale-105 disabled:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {matching ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin text-gray-900 dark:text-white" />
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

      {showCookieBar && (
        <div className="fixed bottom-0 left-0 w-full bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-50 text-sm p-3 flex flex-wrap justify-between items-center z-50 shadow-[0_-2px_6px_rgba(0,0,0,0.1)]">
          <p>
            We use cookies to improve your experience. By browsing, you agree to our&nbsp;
            <a href="/privacy" target="_blank" className="underline">Privacy Policy</a>,&nbsp;
            <a href="/cookies" target="_blank" className="underline">Cookie Policy</a>, and&nbsp;
            <a href="/terms" target="_blank" className="underline">Terms & Conditions</a>.
          </p>
          <button
            onClick={handleCookieDismiss}
            className="bg-emerald-500 hover:bg-emerald-600 text-white rounded px-3 py-1 mt-2 ml-auto"
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
};

export default HomePage;