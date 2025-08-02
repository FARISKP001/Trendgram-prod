import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSocketContext from '../context/useSocketContext';
import './HomePage.css';
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
    <div className="homepage-container">
      <header className="homepage-header">TrendGram</header>

      <button
        onClick={() => setDarkMode((prev) => !prev)}
        className="theme-toggle-btn"
      >
        {darkMode ? '☀️' : '🌙'}
      </button>

      <main className="homepage-main">
        <form onSubmit={handleFindMatch} className="flex justify-center">
          <div className="chatgpt-style-input-wrapper">
            <input
              className="name-input"
              type="text"
              value={name}
              onChange={handleNameChange}
              placeholder="Enter your name"
              required
              maxLength={10}
            />
            <button type="submit" disabled={matching || !name}>
              {matching ? (
                <ArrowPathIcon className="w-4 h-4 animate-spin text-gray-900 dark:text-white" />
              ) : (
                <ArrowRightIcon className="w-4 h-4 text-gray-900 dark:text-white" />
              )}
            </button>
          </div>
        </form>

        {status && <p className="status-msg">{status}</p>}
        {error && <p className="error-msg">{error}</p>}
      </main>

      <footer className="linkie-footer">
        <p>We use cookies to improve your experience. By browsing, you agree to this.</p>
        <ul>
          <li><a href="/privacy-policy" target="_blank" rel="noopener noreferrer">Privacy Policy</a></li>
          <li><a href="/cookie-policy" target="_blank" rel="noopener noreferrer">Cookie Policy</a></li>
          <li><a href="/terms-and-conditions" target="_blank" rel="noopener noreferrer">Terms & Conditions</a></li>
        </ul>
        <p className="copyright">© 2025 TrendGram</p>
      </footer>

      {showCookieBar && (
        <div className="cookie-consent-bar">
          <p>
            We use cookies to improve your experience. By browsing, you agree to our&nbsp;
            <a href="/privacy" target="_blank">Privacy Policy</a>,&nbsp;
            <a href="/cookies" target="_blank">Cookie Policy</a>, and&nbsp;
            <a href="/terms" target="_blank">Terms & Conditions</a>.
          </p>
          <button onClick={handleCookieDismiss}>Got it</button>
        </div>
      )}
    </div>
  );
};

export default HomePage;
