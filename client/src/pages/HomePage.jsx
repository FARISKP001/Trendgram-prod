import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogPanel, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import main from '../assets/main.mp4';
import { SiGmail, SiInstagram, SiX, SiFacebook } from "react-icons/si";
import CookieConsent from '../components/CookieConsent';
import AgeConfirmation from '../components/AgeConfirmation.jsx';
import { useNavigate } from 'react-router-dom';
import useSocketContext from '../context/useSocketContext';
import { useMatchmaking } from '../hooks/useMatchmaking';
import {
  Bars3Icon,
  XMarkIcon,
  ArrowLeftIcon,
} from '@heroicons/react/24/solid';
import FAQAssistant from '../components/FAQAssistant';
import { usePageView } from '../hooks/usePageView';
import { validateText } from '../utils/textFilters';
import { getCookie } from '../utils/cookies';

const languagePlaceholders = {
  English: "Your name",
  Hindi: "आपका नाम",
  Malayalam: "പേര് നൽകുക",
  Tamil: "உங்கள் பெயர்",
  Telugu: "మీ పేరు",
  Kannada: "ನಿಮ್ಮ ಹೆಸರು",
};

const moodEmojis = ['😊', '😢', '😡', '😴', '😍', '🤔', '😂', '😎', '😱', '🤗'];
const RESUME_MATCH_KEY = 'resumeMatchRequest';
const RESUME_MATCH_CRITERIA_KEY = 'resumeMatchCriteria';
const RESUME_MATCH_WINDOW_MS = 120000;

const HomePage = () => {
  usePageView('HomePage');
  const timeoutRef = useRef(null);
  const [shouldAutoplay, setShouldAutoplay] = useState(true);
  const [name, setName] = useState('');
  const [matching, setMatching] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || 'contact@example.com';
  const INSTAGRAM_URL = import.meta.env.VITE_INSTAGRAM_URL || 'https://instagram.com/yourhandle';
  const X_URL = import.meta.env.VITE_X_URL || 'https://x.com/yourhandle';
  const FACEBOOK_URL = import.meta.env.VITE_FACEBOOK_URL || 'https://facebook.com/yourhandle';
  const [deviceId, setDeviceId] = useState(null);
  const [suspendedUntil, setSuspendedUntil] = useState(() => {
    const stored = localStorage.getItem('suspendedUntil');
    return stored ? parseInt(stored, 10) : null;
  });

  // Cookie + Age flow
  const [cookieDone, setCookieDone] = useState(() => !!getCookie('cookieConsentGiven'));
  const [ageConfirmed, setAgeConfirmed] = useState(() => localStorage.getItem('ageConfirmed') === 'true');
  // When true, we show the gate (cookie/age) UI in the hero
  const [showGate, setShowGate] = useState(false);

  // Cookie handlers - these are called by CookieConsent component
  const handleCookieAccept = () => {
    setCookieDone(true);
    // If user clicked Connect and age already confirmed, proceed
    if (showGate && ageConfirmed) {
      setShowGate(false);
      startMatch();
    }
  };
  const handleCookieDecline = () => {
    setCookieDone(true);
    if (showGate && ageConfirmed) {
      setShowGate(false);
      startMatch();
    }
  };

  // Age handlers
  const handleAgeConfirm = () => {
    localStorage.setItem('ageConfirmed', 'true');
    setAgeConfirmed(true);
    if (showGate) {
      setShowGate(false);
      startMatch();
    }
  };
  const handleAgeCancel = () => {
    setShowGate(false);
    setError('You should be minimum 18 to enter to the website.');
  };

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [faqDialogOpen, setFaqDialogOpen] = useState(false);

  // React Router hook
  const navigate = useNavigate();

  // Clean up any stale chat state when HomePage mounts
  // This ensures that if user navigates back from chat, the session is properly cleared
  useEffect(() => {
    // Clear any chat-related sessionStorage that might be stale
    const partnerId = sessionStorage.getItem('partnerId');
    const sessionId = sessionStorage.getItem('sessionId');
    
    if (partnerId || sessionId) {
      console.log('[HomePage] Clearing stale chat state on mount', { partnerId, sessionId });
      // Clear chat session data but keep userId/userName for potential reuse
      sessionStorage.removeItem('partnerId');
      sessionStorage.removeItem('partnerName');
      sessionStorage.removeItem('sessionId');
      sessionStorage.removeItem('chatWsUrl');
      sessionStorage.removeItem('workerWsBase');
    }
  }, []); // Run once on mount

  // Smooth scroll helpers
  const scrollToSection = (id) => {
    const el = document.getElementById(id.replace('#', ''));
    if (!el) return;
    const headerEl = document.querySelector('header');
    const headerOffset = headerEl ? headerEl.offsetHeight : 64; // fallback
    const y = el.getBoundingClientRect().top + window.scrollY - headerOffset - 8;
    window.scrollTo({ top: y, behavior: 'smooth' });
  };

  const handleHeaderLinkClick = (href) => (e) => {
    e.preventDefault();
    if (href?.startsWith('#')) {
      const id = href.replace('#', '');
      scrollToSection(id);
      setActive(id); // 🔥 always highlight immediately on click
    } else if (href) {
      navigate(href);
    }
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

  const navigation = [
    { name: 'Home', href: '#home', label: 'Home' },
    { name: 'About Us', href: '#vision', label: 'About Us' },
    { name: 'Contact', href: '#contact', label: 'Contact Us' },
  ];


  const [active, setActive] = useState('home');

  useEffect(() => {
    const ids = navigation.map(n => n.href.replace('#', ''));
    const observers = [];

    ids.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setActive(id);
        },
        {
          rootMargin: "-10% 0px -10% 0px", // 👈 looser margins so top & bottom sections count
          threshold: 0.05,                 // very small threshold to catch even small intersections
        }
      );
      obs.observe(el);
      observers.push(obs);
    });

    return () => observers.forEach(o => o.disconnect());
  }, [navigation]);



  const navItemClass = (isActive) =>
    `inline-flex items-center gap-2 px-2 py-1 text-xs font-semibold transition
     ${isActive
      ? 'text-black'
      : 'text-black hover:text-purple-600'}`;

  const [selectedOption, setSelectedOption] = useState('connect');
  const [showLanguageSubmenu, setShowLanguageSubmenu] = useState(false);
  const [showMoodDialog, setShowMoodDialog] = useState(false);
  const [showTextDialog, setShowTextDialog] = useState(false);
  const [dialogError, setDialogError] = useState('');
  const [resumeMatchPending, setResumeMatchPending] = useState(null);

  const { socket, isConnected, setUserContext } = useSocketContext();
  const { startMatchmaking, isMatching: isMatchingHook, matchStatus: matchStatusHook } = useMatchmaking();
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

  // Update socket context when name and deviceId are available
  useEffect(() => {
    if (name && deviceId && setUserContext) {
      setUserContext({ userName: name, deviceId });
    }
  }, [name, deviceId, setUserContext]);

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

  }, [socket]);

  // Register user context when ready
  useEffect(() => {
    if (userId.current && deviceId && name && setUserContext) {
      setUserContext({ userName: name, deviceId });
    }
  }, [deviceId, name, setUserContext]);

  useEffect(() => () => timeoutRef.current && clearTimeout(timeoutRef.current), []);
  
  // Check for reduced motion preference
  useEffect(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setShouldAutoplay(!prefersReducedMotion);
  }, []);
  
  useEffect(() => {
    if (!name) {
      setMatching(false);
      setStatus('');
    }
    // Sync matching state from hook
    setMatching(isMatchingHook);
    if (matchStatusHook) {
      setStatus(matchStatusHook);
    }
  }, [name, isMatchingHook, matchStatusHook]);

  // Listen for partner found events from WebSocket
  useEffect(() => {
    // Use ref to track if we've already navigated (prevent duplicate navigations)
    const hasNavigatedRef = { current: false };
    
    const handlePartnerFound = (event) => {
      // Prevent duplicate navigation if already processed
      if (hasNavigatedRef.current) {
        console.log('⚠️ [HomePage] partner_found already processed, ignoring duplicate event');
        return;
      }
      
      const eventDetail = event.detail || {};
      const {
        partnerId,
        partnerName,
        sessionId: sessionIdFromEvent,
        roomId,
        wsUrl,
        workerWsBase,
      } = eventDetail;
      const sessionId = sessionIdFromEvent || roomId || null;
      
      console.log('✅ [HomePage] partner_found event received:', { 
        partnerId, 
        partnerName, 
        sessionId, 
        fullDetail: eventDetail,
        currentName: name,
        currentUserId: userId.current 
      });
      
      // Require partnerId and sessionId (partnerName can be optional, will default to "Stranger")
      if (partnerId && sessionId) {
        const finalPartnerName = partnerName || 'Stranger';
        console.log('✅ [HomePage] Valid partner_found event, navigating to chatbox', { 
          partnerId, 
          partnerName: finalPartnerName,
          sessionId,
          currentName: name,
          currentUserId: userId.current
        });
        
        // Mark as navigated to prevent duplicates
        hasNavigatedRef.current = true;
        
        clearTimeout(timeoutRef.current);
        setStatus('');
        setError('');
        setMatching(false);
        
        console.log('🚀 [HomePage] Navigating to chatbox...');
        
        // Store partner info in sessionStorage BEFORE navigation to ensure it's available
        // This helps the early event listener in ChatBox catch events that arrive early
        sessionStorage.setItem('partnerId', partnerId);
        sessionStorage.setItem('partnerName', finalPartnerName);
        sessionStorage.setItem('sessionId', sessionId);
        if (wsUrl) {
          sessionStorage.setItem('chatWsUrl', wsUrl);
        } else {
          sessionStorage.removeItem('chatWsUrl');
        }
        if (workerWsBase) {
          sessionStorage.setItem('workerWsBase', workerWsBase);
        }
        
        // Use setTimeout(0) to ensure navigation happens in next event loop tick
        // This ensures all state updates are processed first
        setTimeout(() => {
          navigate('/chatbox', {
            state: { 
              userId: userId.current, 
              partnerId, 
              userName: name || 'Stranger', 
              partnerName: finalPartnerName,
              sessionId,
              wsUrl: wsUrl || null,
              workerWsBase: workerWsBase || null,
            },
          });
        }, 0);
      } else {
        console.warn('⚠️ [HomePage] partner_found event missing required fields:', {
          hasPartnerId: !!partnerId,
          hasSessionId: !!sessionId,
          partnerName,
          eventDetail,
        });
      }
    };

    console.log('👂 [HomePage] Setting up partner_found event listener', { name, userId: userId.current });
    window.addEventListener('partner_found', handlePartnerFound);
    
    return () => {
      console.log('🧹 [HomePage] Cleaning up partner_found event listener');
      window.removeEventListener('partner_found', handlePartnerFound);
      hasNavigatedRef.current = false; // Reset on cleanup
    };
  }, [name, navigate]);


  const handleNameChange = (e) => {
    const val = e.target.value;
    setName(val);
    if (!val) return setError('');
    const validation = validateText(val);
    setError(validation.valid ? '' : 'Please follow community guidelines.');
  };


  const startMatch = async () => {
    console.log("🔵 [HomePage] startMatch called", { deviceId, suspendedUntil, name, selectedOption });

    if (!deviceId) {
      console.warn("🔴 [HomePage] No deviceId");
      return setError('Loading device identity...');
    }
    if (suspendedUntil && Date.now() < suspendedUntil) {
      console.warn("🔴 [HomePage] User suspended");
      setError('You are suspended. Please try again later.');
      return;
    }
    const validation = validateText(name);
    if (!validation.valid) {
      console.warn("🔴 [HomePage] Validation failed", validation);
      return setError('Please follow community guidelines.');
    }

    const emotion = moodEmojis.includes(selectedOption) ? selectedOption : null;
    const language = ['English', 'Hindi', 'Malayalam', 'Tamil', 'Telugu', 'Kannada'].includes(selectedOption) ? selectedOption : null;
    
    // Store original matchmaking criteria in sessionStorage for reuse when clicking Next
    if (emotion) sessionStorage.setItem('originalEmotion', emotion);
    else sessionStorage.removeItem('originalEmotion');
    if (language) sessionStorage.setItem('originalLanguage', language);
    else sessionStorage.removeItem('originalLanguage');
    sessionStorage.setItem('originalMode', 'null'); // Store as string for null mode
    sessionStorage.setItem('lastSelectedOption', selectedOption || '');
    try {
      sessionStorage.setItem(RESUME_MATCH_CRITERIA_KEY, JSON.stringify({
        userName: name,
        deviceId,
        selectedOption,
        emotion,
        language,
        mode: null,
        timestamp: Date.now(),
      }));
    } catch (err) {
      console.warn('⚠️ [HomePage] Failed to persist resume match criteria', err);
    }
    sessionStorage.removeItem(RESUME_MATCH_KEY);
    
    console.log("🟢 [HomePage] Starting matchmaking", { 
      userId: userId.current, 
      userName: name, 
      deviceId,
      emotion, 
      language,
      selectedOption 
    });
    
    setMatching(true);
    setError('');
    setStatus('Searching for partner...');

    try {
      console.log("🟢 [HomePage] Calling startMatchmaking hook...");
      const result = await startMatchmaking(
        userId.current,
        name,
        deviceId,
        emotion,
        language,
        null // mode
      );

      console.log("🟢 [HomePage] startMatchmaking returned:", result);
      if (result && result.matched) {
        // Match found, navigation will happen via partner_found event
        console.log("✅ [HomePage] Match found in startMatch!");
        setStatus('');
      }
    } catch (error) {
      console.error("🔴 [HomePage] Matchmaking error:", error);
      setError(error.message || 'Failed to start matchmaking');
      setMatching(false);
      setStatus('');
    }
  };

  const startMatchRef = useRef(startMatch);
  useEffect(() => {
    startMatchRef.current = startMatch;
  }, [startMatch]);

  useEffect(() => {
    const resumeRaw = sessionStorage.getItem(RESUME_MATCH_KEY);
    if (!resumeRaw) return;

    let resumeMeta = null;
    try {
      resumeMeta = JSON.parse(resumeRaw);
    } catch (err) {
      console.warn('⚠️ [HomePage] Invalid resume match metadata', err);
      sessionStorage.removeItem(RESUME_MATCH_KEY);
      return;
    }

    const criteriaRaw = sessionStorage.getItem(RESUME_MATCH_CRITERIA_KEY);
    if (!criteriaRaw) {
      sessionStorage.removeItem(RESUME_MATCH_KEY);
      return;
    }

    let criteria = null;
    try {
      criteria = JSON.parse(criteriaRaw);
    } catch (err) {
      console.warn('⚠️ [HomePage] Invalid resume match criteria', err);
      sessionStorage.removeItem(RESUME_MATCH_KEY);
      return;
    }

    const resumeTimestamp = resumeMeta?.timestamp || criteria?.timestamp || Date.now();
    if (Date.now() - resumeTimestamp > RESUME_MATCH_WINDOW_MS) {
      sessionStorage.removeItem(RESUME_MATCH_KEY);
      return;
    }

    if (criteria?.userName) setName(criteria.userName);
    if (criteria?.selectedOption) setSelectedOption(criteria.selectedOption);
    setShowGate(false);
    setShowMoodDialog(false);
    setShowTextDialog(false);
    setDialogError('');

    setResumeMatchPending({
      ...criteria,
      resumeTimestamp,
    });
  }, []);

  useEffect(() => {
    if (!resumeMatchPending) return;
    if (Date.now() - resumeMatchPending.resumeTimestamp > RESUME_MATCH_WINDOW_MS) {
      sessionStorage.removeItem(RESUME_MATCH_KEY);
      setResumeMatchPending(null);
      return;
    }
    if (!deviceId || !cookieDone || !ageConfirmed) return;
    if (!resumeMatchPending.userName) {
      sessionStorage.removeItem(RESUME_MATCH_KEY);
      setResumeMatchPending(null);
      return;
    }
    if (name !== resumeMatchPending.userName) return;
    if (resumeMatchPending.selectedOption && selectedOption !== resumeMatchPending.selectedOption) return;
    if (matching || isMatchingHook) return;

    sessionStorage.removeItem(RESUME_MATCH_KEY);
    setTimeout(() => {
      startMatchRef.current && startMatchRef.current();
    }, 0);
    setResumeMatchPending(null);
  }, [
    resumeMatchPending,
    deviceId,
    cookieDone,
    ageConfirmed,
    name,
    selectedOption,
    matching,
    isMatchingHook,
  ]);

  const handleFindMatch = (e) => {
    e.preventDefault();
    // Open the gating UI in the hero, then only start after both gates are satisfied
    setShowGate(true);

    // If both already satisfied (e.g., returning user), start immediately
    if (cookieDone && ageConfirmed) {
      setShowGate(false);
      startMatch();
    }
  };



  return (
    <div >


     {/* === Header === */}
      <header className="sticky top-0 z-40 bg-[#990099] text-gray-900 hover:text-emerald-400 dark:bg-[#990099] shadow-sm flex items-center justify-between px-2 sm:px-6">
        {/* ... (rest of the header structure, which remains the same for centering) */}
        <nav aria-label="Global" className="w-full flex items-center justify-between p-6 lg:px-8">
          
          {/* Brand/Logo (Left Side - flex-1) */}
          <div className="flex lg:flex-1 items-center">
            <a
              href="#home"
              onClick={handleHeaderLinkClick('#home')}
              className="text- sm font-extrabold tracking-wide bg-gradient-to-r from-amber-500 to-red-500 bg-clip-text text-transparent font-extrabold"
              aria-label="Go to Home"
            >
              TG
            </a>
          </div>

          {/* Centered Navigation Links and Dropdown (Center Section - flex-1 justify-center) */}
          <div className="hidden lg:flex lg:flex-1 lg:justify-center lg:items-center">

            {/* Navigation Links */}
            <div className="flex lg:gap-x-3">
              {navigation.map(({ name, href, label }) => (
                <a
                  key={name}
                  href={href}
                  onClick={(e) => {
                    e.preventDefault();
                    handleHeaderLinkClick(href)(e);
                    e.currentTarget.blur();
                  }}
                  aria-label={label}
                  title={label}
                  className={navItemClass(active === href.slice(1))}
                >
                  <span>{name}</span>
                </a>

              ))}
            </div>

            {/* Dropdown Menu (Centered, now with Gemini-inspired styling) */}
            <Menu as="div" className="relative inline-block text-left ml-4">
              <div>
            <MenuButton
              // UPDATED STYLES FOR BUTTON: rounded-full, distinct background, and clear focus ring.
              className="inline-flex justify-center items-center gap-x-1.5 rounded-full bg-[#966fd6] text-black px-3 py-2 text-sm font-semibold shadow-sm ring-1 ring-inset ring-purple-500 hover:bg-purple-800 animate-pulse
              focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
                  {selectedOption}
                  {/* Icon remains the same */}
                  <svg className="-mr-1 h-5 w-5 text-black" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                  </svg>
                </MenuButton>
              </div>

              {/* MenuItems - UPDATED CONTAINER STYLES: more rounded, deeper shadow, and cleaner background */}
              <MenuItems
                className="absolute left-1/2 transform -translate-x-1/2 z-10 mt-2 w-48 origin-top rounded-xl
                           bg-[#dda0dd] shadow-2xl ring-1 ring-black/10 focus:outline-none p-1" // Added p-1 for internal spacing
              >
                <div className="py-1">
                  <MenuItem disabled>
                    {({ active, disabled }) => (
                      <button
                        className={`${
                          disabled ? 'opacity-80 cursor-not-allowed' : ''
                        } ${
                          active ? 'bg-purple-200 text-gray-900' : 'text-gray-700'
                          } block px-4 py-1 text-sm w-full text-left rounded-lg transition-colors`}
                      >
                        Select connection mode
                      </button>
                    )}
                  </MenuItem>
                  <MenuItem>
                    {({ active }) => (
                      <button
                        onClick={() => { setSelectedOption('Mood'); setShowMoodDialog(true); }}
                        className={`${
                          active ? 'bg-purple-200 text-gray-900' : 'text-gray-700 hover:bg-purple-200'
                          } block px-4 py-1 text-sm w-full text-left rounded-lg transition-colors`}
                      >
                        Mood
                      </button>
                    )}
                  </MenuItem>
                  <MenuItem>
                    {({ active }) => (
                      <div className="relative" onMouseEnter={() => setShowLanguageSubmenu(true)} onMouseLeave={() => setShowLanguageSubmenu(false)}>
                        <button className="flex items-center justify-between block px-4 py-1 text-sm w-full text-left rounded-lg transition-colors text-gray-700 hover:bg-purple-200" onClick={(e) => e.stopPropagation()} >
                          Language
                          <svg className="-mr-1 h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
                          </svg>
                        </button>
                        {showLanguageSubmenu && (
                          <div className="absolute left-full top-0 mt-0 w-48 origin-top-left rounded-xl bg-[#dda0dd] shadow-2xl ring-1 ring-black/10 p-1 z-20">
                            <div className="py-1">
                              <button
                                onClick={() => { setSelectedOption('English'); setShowTextDialog(true); setShowLanguageSubmenu(false); }}
                                className="block px-4 py-1 text-sm w-full text-left rounded-lg transition-colors text-gray-700 hover:bg-purple-200"
                              >
                                English
                              </button>
                              <button
                                onClick={() => { setSelectedOption('Hindi'); setShowTextDialog(true); setShowLanguageSubmenu(false); }}
                                className="block px-4 py-1 text-sm w-full text-left rounded-lg transition-colors text-gray-700 hover:bg-purple-200"
                              >
                                Hindi
                              </button>
                              <button
                                onClick={() => { setSelectedOption('Malayalam'); setShowTextDialog(true); setShowLanguageSubmenu(false); }}
                                className="block px-4 py-1 text-sm w-full text-left rounded-lg transition-colors text-gray-700 hover:bg-purple-200"
                              >
                                Malayalam
                              </button>
                              <button
                                onClick={() => { setSelectedOption('Tamil'); setShowTextDialog(true); setShowLanguageSubmenu(false); }}
                                className="block px-4 py-1 text-sm w-full text-left rounded-lg transition-colors text-gray-700 hover:bg-purple-200"
                              >
                                Tamil
                              </button>
                              <button
                                onClick={() => { setSelectedOption('Telugu'); setShowTextDialog(true); setShowLanguageSubmenu(false); }}
                                className="block px-4 py-1 text-sm w-full text-left rounded-lg transition-colors text-gray-700 hover:bg-purple-200"
                              >
                                Telugu
                              </button>
                              <button
                                onClick={() => { setSelectedOption('Kannada'); setShowTextDialog(true); setShowLanguageSubmenu(false); }}
                                className="block px-4 py-1 text-sm w-full text-left rounded-lg transition-colors text-gray-700 hover:bg-purple-200"
                              >
                                Kannada
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </MenuItem>
                  <MenuItem>
                    {({ active }) => (
                      <button
                        onClick={() => { setSelectedOption('Text'); setShowTextDialog(true); }}
                        className={`${
                          active ? 'bg-purple-200 text-gray-900' : 'text-gray-700 hover:bg-purple-200'
                          } block px-4 py-1 text-sm w-full text-left rounded-lg transition-colors`}
                      >
                        Text
                      </button>
                    )}
                  </MenuItem>
                </div>
              </MenuItems>
            </Menu>

          </div>

          {/* Mobile Menu Button (Always on the right for mobile, hidden on lg) */}
          <div className="flex lg:hidden items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700 dark:text-gray-200"
            >
              <span className="sr-only">Open main menu</span>
              <Bars3Icon aria-hidden="true" className="size-6" />
            </button>
          </div>
        </nav>

        {/* Mobile menu (Dialog) */}
        <Dialog open={mobileMenuOpen} onClose={setMobileMenuOpen} className="lg:hidden">
          <div className="fixed inset-0 z-50" />
          <DialogPanel className="fixed inset-y-0 right-0 z-50 w-full max-w-sm overflow-y-auto
                        bg-white dark:bg-gray-900 sm:ring-1 sm:ring-gray-900/10">
            {/* Header / Brand */}
            <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700
                  text-white px-6 py-5 flex items-center justify-between">
              <div>
                <p className="text-lg font-extrabold tracking-wide">TrendGram</p>
                <p className="text-xs/relaxed opacity-90">Light, lively conversations</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-full p-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <XMarkIcon className="h-6 w-6" />
                <span className="sr-only">Close menu</span>
              </button>
            </div>

            {/* Nav items */}
            <nav className="px-4 py-4">
              <ul className="space-y-2">
                {navigation.map(({ name, href }) => {
                  const isActive = active === href.slice(1);
                  return (
                    <li key={name}>
                      <button
                        onClick={() => {
                          setMobileMenuOpen(false);
                          setTimeout(() => scrollToSection(href.slice(1)), 60);
                        }}
                        className={`w-full text-left ${navItemClass(isActive)} px-3 py-2`}
                      >

                        <span>{name}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* Divider */}
              <div className="my-5 h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent
                    dark:via-white/15" />

              {/* Sidebar blurb / CTA */}
              <div className="rounded-xl p-4 bg-emerald-50/70 dark:bg-white/5 ring-1 ring-emerald-200/60 dark:ring-white/10">
                <p className="text-sm text-gray-800 dark:text-gray-200">
                  Connect in seconds — no profiles, no pressure. Tap <span className="font-semibold">Connect Now</span> to start chatting.
                </p>
                <button
                  onClick={() => { setMobileMenuOpen(false); setSelectedOption('Text'); scrollToSection('home'); }}
                  className="mt-3 w-full rounded-lg bg-emerald-600 text-white font-semibold py-2 hover:bg-emerald-700"
                >
                  Connect Now
                </button>
              </div>

              {/* Social / Follow us */}
              <div className="mt-6">
                <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Follow us on</p>
                <div className="flex items-center gap-2">
                  <a href={`mailto:${CONTACT_EMAIL}?subject=Hello%20TrendGram`} className="rounded-full p-2 bg-white hover:bg-gray-50">
                    <SiGmail size={14} className="text-[#EA4335]" />
                  </a>
                  <a href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" className="rounded-full p-2 bg-white">
                    <SiInstagram size={14} />
                  </a>
                  <a href={X_URL} target="_blank" rel="noopener noreferrer" className="rounded-full p-2 bg-black text-white">
                    <SiX size={14} />
                  </a>
                  <a href={FACEBOOK_URL} target="_blank" rel="noopener noreferrer" className="rounded-full p-2 bg-[#1877F2] text-white">
                    <SiFacebook size={14} />
                  </a>
                </div>
              </div>

            </nav>

            {/* Tiny footer inside drawer */}
            <div className="px-6 py-4 text-[11px] text-gray-500 dark:text-gray-400">
              © {new Date().getFullYear()} TG
            </div>
          </DialogPanel>
        </Dialog>
      </header>

      {/* === Hero Section === */}
      <div id="home" className="relative isolate">
        <div className="relative min-h-screen sm:h-[40rem] lg:h-[44rem]">
          <video
            src={main}
            autoPlay={shouldAutoplay}
            muted
            loop
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
          />

          {/* Dark overlay for contrast */}
          <div className="absolute inset-0 bg-black/50 md:bg-black/40 mix-blend-multiply" />

          {/* Content */}
          <div className="relative z-10 flex items-center justify-center h-full">
            <div className="mx-auto max-w-6xl px-6 lg:px-8 text-center sm:text-left">
              <div className="w-full max-w-2xl text-white">
                <h1
                  className="font-sans font-bold leading-tight text-2xl sm:text-2xl lg:text-2xl"
                  style={{ textShadow: '0 3px 8px [#682860]' }}
                >
                  small talk, big laughs
                  
                </h1>

                <p
                  className="mt-4 text-base sm:text-sm opacity-95"
                  style={{ textShadow: '0 2px 6px rgba(0,0,0,0.7)' }}
                >
                  Lively conversations with strangers who feel like friends
                </p>

                {/* Connect Button */}
                {(selectedOption === 'connect' || moodEmojis.includes(selectedOption)) && (
                <button
                  onClick={() => {
                    setShowTextDialog(true);
                    if (selectedOption === 'connect') {
                      setSelectedOption('Text');
                    }
                  }}
                  className="mt-8 w-37 mx-auto sm:mx-0 h-[45px] px-6 rounded-full bg-purple-500 border border-purple-600 text-white font-semibold hover:bg-purple-600 animate-pulse"
                >
                  Connect Now
                </button>
                )}
              </div>
            </div>
          </div>

          {/* Cookie → Age gate (shown only after user clicks Connect) */}
          {showGate && (!cookieDone || !ageConfirmed) && (
            <div className="absolute bottom-4 left-0 right-0 z-20 flex flex-col items-center gap-3 font-sans">
              {!cookieDone ? (
                <CookieConsent onAccept={handleCookieAccept} onDecline={handleCookieDecline} />
              ) : !ageConfirmed ? (
                <AgeConfirmation onConfirm={handleAgeConfirm} onCancel={handleAgeCancel} />
              ) : null}
            </div>
          )}


        </div>
      </div>

      {/* === Our Vision (floating card) === */}
      <section id="vision" className="mx-auto max-w-5xl mt-12">
        <div
          className="rounded-2xl 
               bg-gradient-to-br from-emerald-50/90 via-teal-50/80 to-white/90
               dark:from-emerald-900/60 dark:via-teal-800/60 dark:to-gray-900/80
               shadow-xl ring-1 ring-black/5 dark:ring-white/10
               backdrop-blur-md p-6 sm:p-8 md:p-10"
        > 
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight 
                   text-gray-900 dark:text-white text-center font-sans">
            Our Vision
          </h2>

          <div className="mt-5 space-y-6 text-sm leading-relaxed text-gray-700 dark:text-gray-300 font-sans">
            <p>
              At <span className="">TrendGram</span>, we believe in the timeless power of conversation.
              In today’s digital world, social networks are often dominated by filters, likes, endless scrolling feeds,
              and overwhelming noise. What gets buried under all this is the most human thing of all —
              the simple joy of talking. The kind of unplanned, genuine, and heartfelt exchange that can brighten someone’s day,
              spark a new idea, or make a stranger feel like a friend.
            </p>

            <p>
              Our vision is to bring conversations back to the center. We are building a platform where authentic human
              interaction is just one click away — quick, spontaneous, and barrier-free. A digital <em>adda</em>, much like
              India’s street corners, chai stalls, and park benches where strangers often strike up the most unexpected yet
              meaningful chats.
            </p>

            <p>
              <span className="">TrendGram</span> is more than an app — it’s a new-age meeting ground for India’s
              youth and beyond. From Delhi to Mumbai, from Chennai to Kolkata, from small towns to metro cities, it’s a space
              where voices from different languages, cultures, and perspectives can connect without borders, without judgment,
              and without pressure.
            </p>

            <p>
              We want <span className="">TrendGram</span> to feel lightweight, safe, and stylish, built for today’s
              generation that values speed, privacy, and fun — yet designed with a timeless purpose: to remind us all that
              sometimes, a simple conversation can change your mood, your perspective, and maybe even your life.
            </p>

            <p>
              In a world where attention spans are shrinking and interactions are often reduced to emojis and likes,
              <span className="">TrendGram</span> stands for something different — a reminder that India’s
              strength has always been its conversations. Conversations over chai, conversations in trains,
              conversations in classrooms, and now, conversations in a digital space designed with the same spirit of openness
              and warmth.
            </p>

            <p>
              Because at the end of the day, no matter who you are or where you’re from,
              <span className=""> a good conversation can change everything.</span>
            </p>
          </div>
        </div>

      </section>

      <div className="mx-auto max-w-5xl mt-12">
        <div
          className="rounded-2xl 
             bg-gradient-to-br from-emerald-50/90 via-teal-50/80 to-white/90
             dark:from-emerald-900/60 dark:via-teal-800/60 dark:to-gray-900/80
             shadow-xl ring-1 ring-black/5 dark:ring-white/10
             backdrop-blur-md p-6 sm:p-8 md:p-10"
        >
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight 
                 text-gray-900 dark:text-white text-center font-sans">
            Our Mission
          </h2>
          <div className="mt-5 space-y-6 text-sm leading-relaxed text-gray-700 dark:text-gray-300 font-sans">
            <p>
              At <span className="">TrendGram</span>, our mission is to make human connection effortless,
              safe, and meaningful in a digital age where genuine conversations are often overshadowed by noise.
              We believe that every voice matters, and that true connections are built not through profiles or algorithms,
              but through simple, honest conversations.
            </p>

            <p>
              In India — a land of extraordinary diversity, where over a billion people speak in hundreds of languages
              and dialects, practice different cultures, and carry unique stories — connecting meaningfully can often
              feel complicated. <span className="">TrendGram</span> is here to change that. With just one tap,
              you can talk to someone new, whether they are from your own city or a different corner of the world.
              No lengthy sign-ups, no complicated profiles, no filters deciding who you meet — only real people,
              real voices, and real conversations.
            </p>

            <p>
              Privacy is at the heart of <span className="">TrendGram</span>. Your identity remains yours,
              and your freedom to stay anonymous is always protected. In a country where digital growth is rapid and
              online presence is deeply personal, we make sure your safety and security are never compromised.
              A safe and respectful environment is our foundation — supported by strong moderation tools, spam detection
              systems, and reporting features that empower users to take control of their experience.
            </p>

            <p>
              <span className="">TrendGram</span> celebrates inclusion at its core. From metros like Mumbai,
              Delhi, and Bengaluru to smaller towns and villages, everyone has a place here. We connect India to the world —
              from Chennai to Cairo, from Kolkata to New York, from Jaipur to Dubai — breaking down borders and creating
              a global community that respects and values every perspective.
            </p>

            <p>
              Our design is crafted for today’s generation — fresh, stylish, and Gen-Z-friendly. With an interface that
              feels alive, modern, and joyful, <span className="">TrendGram</span> reflects the energy of India’s
              young, tech-savvy population who are leading the world in digital conversations.
            </p>

            <p>
              But we don’t stop there. <span className="">TrendGram</span> is built to evolve continuously —
              learning from our users, adapting to their needs, and refining every detail to create an experience that
              grows richer over time. Because connection is not static — it’s living, dynamic, and ever-changing,
              just like the people of India.
            </p>

            <p>
              At <span className="">TrendGram</span>, we’re not just building a chat platform. We’re building
              a space where India — and the world — can speak freely, connect meaningfully, and discover that sometimes,
              one simple conversation is all it takes to create something extraordinary.
            </p>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl mt-12 mb-16">
        <div
          className="rounded-2xl 
               bg-gradient-to-br from-sky-50/90 via-emerald-50/80 to-white/90
               dark:from-sky-900/60 dark:via-emerald-900/60 dark:to-gray-900/80
               shadow-xl ring-1 ring-black/5 dark:ring-white/10
               backdrop-blur-md p-6 sm:p-8 md:p-10">
          <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight 
                   text-gray-900 dark:text-white text-center font-sans">
            Our Services
          </h2>

          <div className="mt-5 space-y-6 text-sm leading-relaxed text-gray-700 dark:text-gray-300 font-sans">
            <p>
              At <span className="">TrendGram</span>, our services are designed with one goal in mind —
              to bring back the joy of genuine conversations in the simplest way possible. At the heart of our
              platform lies instant random matchmaking, where with just one tap you are paired with a new buddy
              from anywhere in the world. No lengthy profiles, no bios to judge, and no pressure to perform —
              just two people connected by curiosity and conversation.
            </p>

            <p>
              We believe privacy is non-negotiable, which is why <span className="">TrendGram</span>
              never asks for your personal details. You stay anonymous, secure, and completely in control of
              your identity while enjoying the freedom to chat openly and confidently. Our smart queue system,
              powered by advanced technology, ensures fair and fast matching even when thousands of people are
              online at once, making the experience smooth and responsive at any scale.
            </p>

            <p>
              Safety is at the core of our community. Users have the ability to report or block abusive behavior,
              and our automated systems actively detect spam and repeated violations. This helps us nurture a safe,
              respectful, and welcoming space where everyone feels comfortable. To make chats more expressive,
              <span className=""> TrendGram</span> also offers a modern emoji picker designed with ease
              in mind — quick categories, search options, and recents that make sharing emotions as effortless as words.
            </p>

            <p>
              Our service adapts seamlessly across devices, whether you are chatting on your phone during a chai break,
              using your tablet while traveling on the train, or connecting on your laptop at home.
              <span className=""> TrendGram</span> is lightweight, responsive, and built to feel natural
              wherever you are. Most importantly, we remove unnecessary barriers. Unlike traditional apps that burden
              you with endless steps before you can even talk, <span className="">TrendGram</span> is
              designed for spontaneity — so that meeting someone new feels instant, natural, and fun.
            </p>
          </div>
        </div>
      </div>

      <section id="contact" className="scroll-mt-20">
        <footer className="bg-[#966fd6] border-t border-black/5 dark:border-white/10">
          <div className="mx-auto max-w-6xl px-6 lg:px-4 py-4">
          <div className="mt-4 flex flex-col items-center justify-between gap-4 border-t border-black/10 dark:border-white/10 pt-2 md:flex-row">
            <div className="text-sm text-[#000000] flex items-center gap-2">
              © {new Date().getFullYear()} TG
              <a href="/policies" className="hover:text-gray-700 dark:hover:text-gray-300">Policy</a>
              <a href="/terms" className="hover:text-gray-700 dark:hover:text-gray-300">Terms</a>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={INSTAGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center"
                aria-label="Instagram"
              >
                <SiInstagram size={12} />
              </a>
              <a
                href={X_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center"
                aria-label="X"
              >
                <SiX size={12} />
              </a>
              <a
                href={FACEBOOK_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center"
                aria-label="Facebook"
              >
                <SiFacebook size={12} />
              </a>
            </div>
          </div>
          </div>
        </footer>
      </section>



      {/* Mood Dialog */}
      <Dialog open={showMoodDialog} onClose={() => {}} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel static className="relative max-w-md text-center">
            <h3 className="text-lg font-semibold text-purple-900 mb-4">Select your mood</h3>
            <div className="grid grid-cols-5 gap-2 mb-4">
              {moodEmojis.map((emoji, index) => (
                <button
                  key={index}
                  onClick={() => {
                    socket?.emit('select_mood', { userId: userId.current, mood: emoji });
                    setSelectedOption(emoji);
                    setShowMoodDialog(false);
                    // Automatically open text dialog to enter name
                    setShowTextDialog(true);
                    console.log("🟡 [HomePage] Mood selected, opening text dialog for name input");
                  }}
                  className="text-2xl hover:bg-purple-100 rounded-lg p-2 transition-colors"
                  aria-label={`Select ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowMoodDialog(false);
                setSelectedOption('connect');
              }}
              className="mt-0 text-purple-400 hover:text-purple-900"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </button>
          </DialogPanel>
        </div>
      </Dialog>

      {/* Text Dialog */}
      <Dialog open={showTextDialog} onClose={() => {}} className="relative z-50">
        <div className="fixed inset-0 bg-black/30" aria-hidden="true" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
      <DialogPanel static className="relative max-w-md text-center">
        <div className="flex gap-2 mb-1">
          <input
            type="text"
            maxLength={10}
            placeholder={languagePlaceholders[selectedOption] || "Enter your name"}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!e.target.value) {
                setDialogError('');
                return;
              }
              const validation = validateText(e.target.value);
              setDialogError(validation.valid ? '' : 'Please follow community guidelines.');
            }}
            className="flex-1 rounded-md border border-purple-300 bg-purple-200 px-3 py-1.5 text-sm text-gray-900 placeholder-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          />
          <button
            type="button"
            onClick={() => {
              console.log("🔵 [HomePage] Send button clicked!", { name, selectedOption, matching, dialogError });
              if (!name) {
                console.warn("🔴 [HomePage] No name entered");
                setDialogError('Name is required.');
                return;
              }
              if (dialogError) {
                console.warn("🔴 [HomePage] Dialog error present:", dialogError);
                return;
              }
              console.log("🟢 [HomePage] Closing dialog and starting match...");
              setShowTextDialog(false);
              setDialogError('');
              startMatch();
            }}
            disabled={matching || !name || dialogError !== ''}
            className="inline-flex justify-center items-center text-white hover:text-purple-300 disabled:opacity-50 disabled:cursor-not-allowed p-0"
            aria-label="Connect"
            style={{ background: 'none', boxShadow: 'none', border: 'none' }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={5}
              stroke="Purple"
              className="h-5 w-5"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1110.5 3a7.5 7.5 0 016.15 13.65z"
              />
            </svg>
          </button>
        </div>

        {dialogError && <p className="text-xs text-red-600">{dialogError}</p>}

        <button
          type="button"
          onClick={() => {
            setShowTextDialog(false);
            setSelectedOption('connect');
            setDialogError('');
          }}
          className="mt-0 text-purple-400 hover:text-purple-900"
        >
          <ArrowLeftIcon className="h-4 w-4" />
        </button>
      </DialogPanel>
        </div>
      </Dialog>

      {/* FAQ Assistant Dialog */}
      <FAQAssistant isOpen={faqDialogOpen} onClose={() => setFaqDialogOpen(false)} />

      {/* Toast Container for notifications */}
      <ToastContainer
        position="bottom-right"
        autoClose={3000}
        closeOnClick
        pauseOnHover
      />

      {/* Floating FAQ Button - Bottom Right */}
      <button
        onClick={() => setFaqDialogOpen(!faqDialogOpen)}
        className={`fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full shadow-2xl flex items-center justify-center transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
          faqDialogOpen 
            ? 'bg-purple-600 hover:bg-purple-700 focus:ring-purple-500' 
            : 'bg-purple-600 hover:bg-purple-700 focus:ring-purple-500'
        }`}
        title="View FAQs"
        aria-label="View FAQs"
      >
        {faqDialogOpen ? (
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M19 9l-7 7-7-7" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          </svg>
        ) : (
          <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Chat bubble background */}
            <path d="M2 10C2 6.68629 4.68629 4 8 4H16C19.3137 4 22 6.68629 22 10C22 13.3137 19.3137 16 16 16H11.9686C11.4851 16 10.9607 16.2174 10.6083 16.4645L7.33774 18.9209C6.62352 19.4172 6 18.8192 6 18.0002V16.9635C3.76076 15.8888 2 13.6226 2 10Z" fill="white"/>
            {/* Person figure 1 (filled) */}
            <circle cx="10" cy="10" r="1.5" fill="#9333ea"/>
            <path d="M8 12C8 11.4477 8.44772 11 9 11C9.55228 11 10 11.4477 10 12V13H8V12Z" fill="#9333ea"/>
            {/* Person figure 2 (outline) */}
            <circle cx="14" cy="10" r="1.5" stroke="#9333ea" strokeWidth="1.5" fill="none"/>
            <path d="M12 12C12 11.4477 12.4477 11 13 11C13.5523 11 14 11.4477 14 12V13H12V12Z" stroke="#9333ea" strokeWidth="1.5" fill="none"/>
          </svg>
        )}
      </button>

    </div>
  );
};

export default HomePage;
