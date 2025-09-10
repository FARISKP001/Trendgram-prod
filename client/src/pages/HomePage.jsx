import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogPanel } from '@headlessui/react';
import main from '../assets/main.png';
import { SiGmail, SiInstagram, SiX, SiFacebook } from "react-icons/si";
import CookieConsent from '../components/CookieConsent';
import AgeConfirmation from '../components/AgeConfirmation.jsx';
import { useNavigate } from 'react-router-dom';
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
import { validateText } from '../utils/textFilters';

const HomePage = () => {
  usePageView('HomePage');
  const timeoutRef = useRef(null);
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

  const [ageConfirmed, setAgeConfirmed] = useState(() => localStorage.getItem('ageConfirmed') === 'true');
  const [showAgeModal, setShowAgeModal] = useState(false);
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
    { name: 'Vision', href: '#vision', Icon: InformationCircleIcon, label: 'Vision' },
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
      setStatus('');
      setError('');
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

  const handleNameChange = (e) => {
    const val = e.target.value;
    setName(val);
    if (!val) return setError('');
    const validation = validateText(val);
    setError(validation.valid ? '' : 'Please follow community guidelines.');
  };


  const startMatch = () => {
    console.log("startMatch called", { deviceId, suspendedUntil, socket, isConnected, name });

    if (socket?.disconnected) socket.connect();

    if (!deviceId) return setError('Loading device identity...');
    if (suspendedUntil && Date.now() < suspendedUntil) {
      setError('You are suspended. Please try again later.');
      return;
    }
    const validation = validateText(name);
    if (!validation.valid) {
      console.log("Validation failed", validation);
      return setError('Please follow community guidelines.');
    }
    if (!socket?.connected) {
      console.log("Socket issue", { socket, isConnected });
      return setError('Socket not connected.');
    }

    console.log("Emitting find_new_buddy", { userId: userId.current, userName: name });
    socket.emit('find_new_buddy', { userId: userId.current, userName: name, deviceId });
    setMatching(true);
    timeoutRef.current = setTimeout(() => {
      setMatching(false);
      setStatus('No partner is available');
    }, 60 * 1000);
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
      <header className="sticky top-0 z-40 bg-white/20 backdrop-blur-xl text-gray-100 hover:text-emerald-400
 dark:bg-[#203325] shadow-sm flex items-center justify-between px-4 sm:px-6">
        <div className="flex items-center">
          {/* Brand clicks scroll to Home */}
          <a
            href="#home"
            onClick={handleHeaderLinkClick('#home')}
            className="text-4xl font-extrabold tracking-wide bg-gradient-to-r from-amber-500 to-red-500 bg-clip-text text-transparent font-extrabold"
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


      {/* === Hero Section (screenshot-style) === */}
      <div id="home" className="relative isolate">
        <div className="relative h-[34rem] sm:h-[40rem] lg:h-[44rem]">
          <img
            src={main}
            alt="TrendGram"
            className="absolute inset-0 h-full w-full object-cover"
          />

          {/* Overlay */}
          <div className="absolute inset-0 bg-emerald-900/35 md:bg-emerald-900/25 mix-blend-multiply" />
          {/* Content */}
          <div className="relative z-10 h-full">
            <div className="mx-auto h-full max-w-6xl px-6 lg:px-8">
              <div className="flex h-full items-center">
                <div className="w-full max-w-2xl text-left text-white">
                  <h1 className="font-sans font-extrabold leading-tight text-4xl sm:text-5xl lg:text-6xl">
                    small talk
                    <br /> big laughs
                  </h1>

                  <p className="mt-6 text-base sm:text-lg opacity-95">
                    Lively conversations with strangers who feel like friends
                  </p>

                  {/* If not clicked, show CTA */}
                  {!showConnect ? (
                    <button
                      type="button"
                      onClick={() => setShowConnect(true)}
                      className="mt-8 inline-flex items-center rounded-md
                           bg-emerald-500 px-5 py-3 text-base font-semibold
                           text-white shadow hover:bg-emerald-600
                           focus-visible:outline-none focus-visible:ring-2
                           focus-visible:ring-white/80 focus-visible:ring-offset-2
                           focus-visible:ring-offset-emerald-700"
                    >
                      Connect Now
                    </button>
                  ) : (
                    // When clicked, show input form in same place
                    <form
                      onSubmit={handleFindMatch}
                      className="mt-8 flex flex-col gap-4 w-full max-w-md"
                    >
                      <div className="flex items-center gap-3 bg-white/80 rounded-full px-3 py-2 shadow">
                        <input
                          ref={nameInputRef}
                          className="flex-1 h-[45px] rounded-full border border-gray-300
                               bg-transparent px-3 text-gray-900 text-lg
                               placeholder-gray-600 outline-none"
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
                          className="h-[45px] px-5 rounded-full bg-emerald-500 border border-emerald-600
                               text-white font-semibold hover:bg-emerald-600
                               disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {matching ? 'Connecting…' : 'Connect'}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowConnect(false)}
                        className="self-start rounded-full px-4 py-2 text-sm font-medium
                             text-white bg-emerald-700/80"
                      >
                        Cancel
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* === Our Vision (floating card) === */}
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
      </div>


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

      <footer id="contact" className="scroll-mt-20 bg-[#dcdcdc] border-t border-black/5 dark:border-white/10">
        <div className="mx-auto max-w-6xl px-6 lg:px-8 py-8">
          {/* Simple text layout, no cards */}
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <h4 className="text-lg font-semibold text-gray-900 dark:text-white"></h4>

              <div className="mt-4 flex flex-wrap items-center gap-3 md:gap-4">
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=Hello%20TrendGram&body=Hi%20TrendGram,%0A%0A`}
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold
             bg-white hover:bg-gray-100 transition"
                  aria-label="Gmail"
                >
                  <SiGmail size={22} className="text-[#EA4335]" /> {/* this will show correct colored Gmail logo */}
                </a>


                <a
                  href={INSTAGRAM_URL}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2
                             bg-[linear-gradient(45deg,#F58529,#FEDA77,#DD2A7B,#8134AF,#515BD4)]"
                  aria-label="Instagram"
                >
                  <SiInstagram size={20} />

                </a>

                <a
                  href={X_URL}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-lg font-bold
                              text-[#FFFFFF] bg-[#000000] "
                  aria-label="X"
                >
                  <SiX size={20} />

                </a>

                <a
                  href={FACEBOOK_URL}
                  target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-lg font-bold
                              text-[#000000] bg-[#1877F2] "
                  aria-label="Facebook"
                >
                  <SiFacebook size={20} />

                </a>
              </div>
            </div>
          </div>

          <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-black/10 dark:border-white/10 pt-6 md:flex-row">
            <p className="text-md font-bold text-[#000000]">
              © {new Date().getFullYear()} TrendGram
            </p>
            <a
              href="#home"
              onClick={handleHeaderLinkClick('#home')}
              className="text-md font-bold text-[#000000]"
            >
              Back to top ↑
            </a>
          </div>
        </div>
      </footer>

    </div>
  );
};

export default HomePage;
