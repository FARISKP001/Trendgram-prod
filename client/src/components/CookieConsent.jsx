import React, { useState, useEffect } from "react";

const CookieConsent = () => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("cookieConsentGiven")) {
      setShow(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem("cookieConsentGiven", "true");
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center">
      {/* Dimmed background */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      {/* Consent box */}
      <div className="relative z-10 w-[90vw] max-w-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl flex flex-col items-center text-center px-5 py-7">
        <div className="mb-2 text-lg font-bold text-gray-900 dark:text-white">
          We use cookies to improve your experience.
        </div>
        <div className="text-gray-700 dark:text-gray-300 text-sm mb-5">
          By browsing, you agree to our{" "}
          <a href="/privacy" className="text-blue-700 dark:text-blue-400 underline">Privacy Policy</a>
          {", "}
          <a href="/cookies" className="text-blue-700 dark:text-blue-400 underline">Cookie Policy</a>
          {", and "}
          <a href="/terms" className="text-blue-700 dark:text-blue-400 underline">Terms & Conditions</a>.
        </div>
        <button
          className="mt-2 px-7 py-2 bg-blue-800 hover:bg-blue-700 text-white rounded-xl font-semibold shadow transition w-full sm:w-auto"
          onClick={handleAccept}
        >
          Got it
        </button>
      </div>
    </div>
  );
};

export default CookieConsent;