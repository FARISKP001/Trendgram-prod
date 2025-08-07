import React, { useState, useEffect } from "react";
import { getCookie, setCookie } from "../utils/cookies.js";

// Renders a small consent bar that appears beneath the name input.
// The consent state is stored in a cookie so the banner is hidden once accepted.
const CookieConsent = () => {
  const [show, setShow] = useState(() => !getCookie("cookieConsentGiven"));

  useEffect(() => {
    setShow(!getCookie("cookieConsentGiven"));
  }, []);

  const handleAccept = () => {
    // Persist acceptance for one year
    setCookie("cookieConsentGiven", "true", { days: 365 });
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="w-full max-w-[600px] mt-4 bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-gray-800 dark:to-gray-900 border border-indigo-200 dark:border-gray-700 rounded-2xl shadow-lg p-4 text-sm sm:text-base text-center flex flex-col sm:flex-row items-center gap-4">
      <span className="text-gray-700 dark:text-gray-300 flex-1">
        <span className="mr-1" role="img" aria-label="cookie">🍪</span>
        Cookies help us serve you better. By using our site, you consent to cookies.{' '}
        <a href="/privacy-policy" className="text-blue-700 dark:text-blue-400 underline">Privacy Policy</a>,{' '}
        <a href="/cookie-policy" className="text-blue-700 dark:text-blue-400 underline">Cookie Policy</a> and{' '}
        <a href="/terms-and-conditions" className="text-blue-700 dark:text-blue-400 underline">Terms & Conditions</a>.
      </span>
      <button
        className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-full font-semibold shadow transition-colors"
        onClick={handleAccept}
      >
        Got it
      </button>
    </div>
  );
};

export default CookieConsent;
