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
    <div className="w-full max-w-[600px] mt-4 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow p-4 text-sm text-center flex flex-col sm:flex-row items-center gap-4">
      <span className="text-gray-700 dark:text-gray-300 flex-1">
        We use cookies to improve your experience. By browsing, you agree to our{' '}
        <a href="/privacy" className="text-blue-700 dark:text-blue-400 underline">Privacy Policy</a>,{' '}
        <a href="/cookies" className="text-blue-700 dark:text-blue-400 underline">Cookie Policy</a> and{' '}
        <a href="/terms" className="text-blue-700 dark:text-blue-400 underline">Terms & Conditions</a>.
      </span>
      <button
        className="px-5 py-2 bg-blue-800 hover:bg-blue-700 text-white rounded-xl font-semibold shadow"
        onClick={handleAccept}
      >
        Got it
      </button>
    </div>
  );
};

export default CookieConsent;
