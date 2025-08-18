import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogPanel } from '@headlessui/react';
import main from '../assets/main.png';
import { SiInstagram, SiX, SiFacebook } from "react-icons/si";
import CaptchaModal from '../components/CaptchaModal.jsx';
import CookieConsent from '../components/CookieConsent';
import { getCookie, setCookie } from "../utils/cookies.js";
import AgeConfirmation from '../components/AgeConfirmation.jsx';
import { useNavigate, Link } from 'react-router-dom';
import useSocketContext from '../context/useSocketContext';
import {
  Bars3Icon,
  XMarkIcon,
  DevicePhoneMobileIcon,
  ChatBubbleLeftRightIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  SparklesIcon,
  EnvelopeIcon,
  HomeIcon,
  InformationCircleIcon,
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
  const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || 'contact@example.com';
  const INSTAGRAM_URL = import.meta.env.VITE_INSTAGRAM_URL || 'https://instagram.com/yourhandle';
  const X_URL = import.meta.env.VITE_X_URL || 'https://x.com/yourhandle';
  const FACEBOOK_URL = import.meta.env.VITE_FACEBOOK_URL || 'https://facebook.com/yourhandle';
  const [deviceId, setDeviceId] = useState(null);
  const [suspendedUntil, setSuspendedUntil] = useState(() => {
    const stored = localStorage.getItem('suspendedUntil');
    return stored ? parseInt(stored, 10) : null;
  });
  const [showCaptcha, setShowCaptcha] = useState(false);
  const [captchaVerified, setCaptchaVerified] = useState(() => !!getCookie('captchaCooldown'));
  const [ageConfirmed, setAgeConfirmed] = useState(() => localStorage.getItem('ageConfirmed') === 'true');
  const [showAgeModal, setShowAgeModal] = useState(false);
  const [showAnonymous, setShowAnonymous] = useState(false);
  const pendingAction = useRef(null);
  const siteKey = import.meta.env.VITE_CF_SITE_KEY;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // === Smooth scroll helpers ===
  const scrollToSection = (id) => {
    const el = document.getElementById(id.replace('#', ''));
    if (!el) return;
    const headerEl = document.querySelector('header');
    const headerOffset = headerEl ? headerEl.offsetHeight : 64; // fallback
    const y = el.getBoundingClientRect().top + window.scrollY - headerOffset - 8; // tiny breathing room
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  const navigate = useNavigate();
  const handleHeaderLinkClick = (href) => (e) => {
    e.preventDefault();
    if (href?.startsWith('#')) scrollToSection(href.slice(1));
    else if (href) navigate(href);
  };

  // Handle any deep link like #home, #about, #contact (StrictMode-safe)
  const didHashScroll = useRef(false);
  useEffect(() => {
    if (didHashScroll.current) return;
    didHashScroll.current = true;
    const hash = window.location.hash?.slice(1);
    if (!hash) return;
    requestAnimationFrame(() => scrollToSection(hash));
  }, []);

  // === Header nav (Home → About Us → Contact Us) ===
  const navigation = [
    { name: 'Home', href: '#home', Icon: HomeIcon, label: 'Home' },
    { name: 'About Us', href: '#about', Icon: InformationCircleIcon, label: 'About Us' },
    { name: 'Contact Us', href: '#contact', Icon: EnvelopeIcon, label: 'Contact Us' },
  ];

  // Show input only after clicking Connect Buddy
  const [showConnect, setShowConnect] = useState(false);
  const nameInputRef = useRef(null);
  useEffect(() => {
    if (showConnect) nameInputRef.current?.focus();
  }, [showConnect]);

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
    if (socket && !socket.connected) socket.connect();
  }, [socket]);

  // Register user when ready
  useEffect(() => {
    if (socket && isConnected && userId.current && deviceId && name) {
      socket.emit('register_user', { userId: userId.current, deviceId, userName: name });
    }
  }, [socket?.id, isConnected, deviceId, name, socket]);

  useEffect(() => () => timeoutRef.current && clearTimeout(timeoutRef.current), []);
  useEffect(() => {
    if (!name && timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      setMatching(false);
      setStatus('');
    }
  }, [name]);

  // Matching events
  useEffect(() => {
    if (!socket || !isConnected) return;
    const handleNoBuddyFound = () => {
      clearTimeout(timeoutRef.current);
      setMatching(false);
      setStatus('❌ No partner found. Please try again.');
    };
    const handlePartnerFound = ({ partnerId, partnerName }) => {
      clearTimeout(timeoutRef.current);
      navigate('/chatbox', {
        state: { userId: userId.current, partnerId, userName: name, partnerName },
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

  // Captcha flow
  useEffect(() => {
    if (!socket) return;
    const handleCaptcha = () => {
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
    if (!deviceId || !name) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/verify-captcha`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, deviceId }),
      });
      const data = await res.json();
      if (data.success) {
        setCookie('captchaCooldown', 'true', { minutes: 1 });
        setCaptchaVerified(true);
        setShowCaptcha(false);
        socket.emit('register_user', { userId: userId.current, deviceId, userName: name });
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
    console.log("startMatch called", { deviceId, suspendedUntil, socket, isConnected, name });

    if (!deviceId) return setError('Loading device identity...');
    if (suspendedUntil && Date.now() < suspendedUntil) {
      setError('You are suspended temporarily.');
      return;
    }
    const validation = validateText(name);
    if (!validation.valid) {
      console.log("Validation failed", validation);
      return setError('Please enter a valid name.');
    }
    if (!socket || !isConnected) {
      console.log("Socket issue", { socket, isConnected });
      return setError('Socket not connected.');
    }

    ensureCaptcha(() => {
      console.log("Emitting find_new_buddy", { userId: userId.current, userName: name });
      socket.emit('find_new_buddy', { userId: userId.current, userName: name, deviceId });
      setMatching(true);
      timeoutRef.current = setTimeout(() => {
        setMatching(false);
        setStatus('No partner is available');
      }, 60 * 1000);
    });
  };


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
    <div className="bg-white dark:bg-gray-900">
      {/* === Header === */}
      <header className="sticky top-0 z-50 bg-[#e6f7ec] dark:bg-[#203325] shadow-sm flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center">
          {/* Brand clicks scroll to Home */}
          <a
            href="#home"
            onClick={handleHeaderLinkClick('#home')}
            className="text-2xl font-extrabold tracking-wide bg-gradient-to-r from-green-600 via-emerald-500 to-teal-500 bg-clip-text text-transparent cursor-pointer"
            aria-label="Go to Home"
          >
            TrendGram
          </a>
        </div>

        <nav aria-label="Global" className="flex items-center justify-between p-6 lg:px-8">
          <div className="flex lg:flex-1">
            <a href="#" className="-m-1.5 p-1.5">
              <span className="sr-only">TrendGram</span>
            </a>
          </div>

          <div className="flex lg:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700 dark:text-gray-200"
            >
              <span className="sr-only">Open main menu</span>
              <Bars3Icon aria-hidden="true" className="size-6" />
            </button>
          </div>

          <div className="hidden lg:flex lg:gap-x-3">
            {navigation.map(({ name, href, Icon, label }) => (
              <a
                key={name}
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  handleHeaderLinkClick(href)(e);
                  e.currentTarget.blur(); // remove focus so ring doesn't stay
                }}
                aria-label={label}
                title={label}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full
                 text-gray-900 dark:text-white
                 hover:bg-black/5 dark:hover:bg-white/10
                 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
                 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900
                 transition"
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="sr-only">{label}</span>
              </a>
            ))}
          </div>

          <div className="hidden lg:flex lg:flex-1 lg:justify-end">
            <span className="text-sm font-semibold text-transparent">.</span>
          </div>
        </nav>

        {/* Mobile menu */}
        <Dialog open={mobileMenuOpen} onClose={setMobileMenuOpen} className="lg:hidden">
          <div className="fixed inset-0 z-50" />
          <DialogPanel className="fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-white p-6 sm:max-w-sm sm:ring-1 sm:ring-gray-900/10 dark:bg-gray-900 dark:sm:ring-gray-100/10">
            <div className="flex items-center justify-between">
              <a href="#" className="-m-1.5 p-1.5">
                <span className="sr-only">TrendGram</span>
              </a>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="-m-2.5 rounded-md p-2.5 text-gray-700 dark:text-gray-200"
              >
                <span className="sr-only">Close menu</span>
                <XMarkIcon aria-hidden="true" className="size-6" />
              </button>
            </div>

            <div className="mt-6 flow-root">
              <div className="-my-6 divide-y divide-gray-500/10 dark:divide-white/10">
                <div className="space-y-2 py-6">
                  {navigation.map((nav) => (
                    <a
                      key={nav.label}
                      href={nav.href}
                      onClick={(e) => {
                        e.preventDefault();
                        setMobileMenuOpen(false);
                        setTimeout(() => {
                          if (nav.href?.startsWith('#')) scrollToSection(nav.href.slice(1));
                          else if (nav.href) navigate(nav.href);
                        }, 50);
                      }}
                      className="-mx-3 block rounded-lg px-3 py-2 text-base font-semibold text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-white/5"
                    >
                      {nav.label}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </DialogPanel>
        </Dialog>
      </header>

      {/* === Hero Section === */}
      <div id="home" className="relative isolate px-0 pt-0">
        <div className="relative h-[32rem] sm:h-[40rem] lg:h-[44rem]">
          <img src={main} alt="TrendGram" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative z-10 flex h-full flex-col items-center justify-center text-center px-6">
            <h1 className="text-4xl sm:text-6xl font-bold text-white drop-shadow-lg leading-tight">
              Small talk, big laughs
            </h1>
            <p className="mt-4 max-w-2xl text-lg sm:text-xl text-gray-200">
              Light, lively conversations with strangers who feel like friends in minutes.
            </p>

            {!showConnect ? (
              <button
                type="button"
                onClick={() => setShowConnect(true)}
                className="mt-8 inline-flex items-center rounded-xl bg-white/90 px-5 py-3 text-sm font-semibold text-gray-900 shadow hover:bg-white"
              >
                Connect Buddy
              </button>
            ) : (
              <form onSubmit={handleFindMatch} className="mt-8 w-full max-w-[360px] mx-auto">
                <div className="grid grid-cols-[1fr_auto] items-center gap-3 bg-white/90 rounded-full px-3 py-2 shadow">
                  <input
                    ref={nameInputRef}
                    className="min-w-0 w-full bg-transparent text-gray-900 placeholder-gray-600 outline-none rounded-full border-2 border-[#a6d608] h-[45px] text-lg px-3"
                    type="text"
                    value={name}
                    onChange={handleNameChange}
                    placeholder="Enter your name"
                    required
                    maxLength={10}
                    inputMode="text"
                    enterKeyHint="go"
                  />
                  <button
                    type="submit"
                    disabled={matching || !name || (suspendedUntil && Date.now() < suspendedUntil)}
                    className="inline-flex items-center justify-center h-[45px] px-5 rounded-full bg-sky-300 hover:bg-sky-400 transition-transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed border-2 border-sky-500 font-semibold"
                  >
                    {matching ? 'Connecting…' : 'Connect'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowConnect(false)}
                  className="mt-3 text-sm text-white/90 underline decoration-white/40 hover:decoration-white"
                >
                  ← Back
                </button>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* === About Us (under hero) === */}
      <section id="about" className="scroll-mt-20 bg-white dark:bg-gray-900">
        <div className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
          <div className="text-center max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-gray-900 dark:text-white">About Us</h2>
            <p className="mt-4 text-lg sm:text-xl text-gray-700 dark:text-gray-300">
              <span className="font-semibold">Effortless connections. Thoughtful design.</span><br />
              TrendGram delivers refined, lightweight conversations with people worldwide. Tap{' '}
              <span className="font-semibold">Connect Buddy</span> for instant matching—no public profiles, minimal friction.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/5 p-6 backdrop-blur">
              <div className="flex items-center gap-3">
                <SparklesIcon className="size-6 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">What sets us apart</h3>
              </div>
              <ul className="mt-4 space-y-3 text-gray-700 dark:text-gray-300">
                <li className="flex items-start gap-3">
                  <DevicePhoneMobileIcon className="size-5 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Elegant, fast experience on any device</span>
                </li>
                <li className="flex items-start gap-3">
                  <ChatBubbleLeftRightIcon className="size-5 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Short, meaningful exchanges—on your terms</span>
                </li>
                <li className="flex items-start gap-3">
                  <LockClosedIcon className="size-5 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Privacy-forward by design</span>
                </li>
              </ul>
            </div>

            <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/5 p-6 backdrop-blur">
              <div className="flex items-center gap-3">
                <ShieldCheckIcon className="size-6 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Trust &amp; safety</h3>
              </div>
              <p className="mt-4 text-gray-700 dark:text-gray-300">
                18+ access, active moderation, reporting tools, and anti-spam systems. Temporary messaging during chats—no data sales.
              </p>
            </div>

            <div className="rounded-2xl border border-black/10 dark:border-white/10 bg-white/80 dark:bg-white/5 p-6 backdrop-blur">
              <div className="flex items-center gap-3">
                <SparklesIcon className="size-6 text-emerald-600 dark:text-emerald-400" />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Our standard</h3>
              </div>
              <p className="mt-4 text-gray-700 dark:text-gray-300">Respect, reliability, and calm joy in every interaction.</p>
            </div>
          </div>
        </div>
      </section>

      {/* === Footer (Contact) — not cards === */}
      <footer id="contact" className="scroll-mt-20 bg-gray-50 dark:bg-gray-900 border-t border-black/5 dark:border-white/10">
        <div className="mx-auto max-w-6xl px-6 lg:px-8 py-16">
          {/* Simple text layout, no cards */}
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <h4 className="text-lg font-semibold text-gray-900 dark:text-white">Connect with us</h4>

              <div className="mt-4 flex flex-wrap items-center gap-3 md:gap-4">
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=Hello%20TrendGram&body=Hi%20TrendGram,%0A%0A`}
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold
                             border-gray-300/70 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10"
                >
                  <EnvelopeIcon className="size-5" />
                  Email
                </a>

                <a
                  href={INSTAGRAM_URL}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold
                             border-gray-300/70 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10"
                  aria-label="Instagram"
                >
                  <SiInstagram size={20} />
                  Instagram
                </a>

                <a
                  href={X_URL}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold
                             border-gray-300/70 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10"
                  aria-label="X"
                >
                  <SiX size={20} />
                  X
                </a>

                <a
                  href={FACEBOOK_URL}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold
                             border-gray-300/70 text-gray-800 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10"
                  aria-label="Facebook"
                >
                  <SiFacebook size={20} />
                  Facebook
                </a>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-black/10 dark:border-white/10 pt-6 md:flex-row">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              © {new Date().getFullYear()} TrendGram
            </p>
            <a
              href="#home"
              onClick={handleHeaderLinkClick('#home')}
              className="text-sm text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white"
            >
              Back to top ↑
            </a>
          </div>
        </div>
      </footer>

      {/* Optional modals */}
      {showCaptcha && <CaptchaModal siteKey={siteKey} onSuccess={handleCaptchaSuccess} onClose={() => setShowCaptcha(false)} />}
      {showAgeModal && <AgeConfirmation onConfirm={handleAgeConfirm} onCancel={handleAgeCancel} />}
      <CookieConsent />
    </div>
  );
};

export default HomePage;
