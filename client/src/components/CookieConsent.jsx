  import React, { useState, useEffect } from "react";
  import { getCookie, setCookie } from "../utils/cookies.js";

  const COOKIE_NAME = "cookieConsentGiven";
  const COOKIE_MAX_DAYS = 365;

export default function CookieConsent({ onAccept, onDecline }) {
    // show only if there isn't a stored decision
    const [show, setShow] = useState(() => !getCookie(COOKIE_NAME));

    useEffect(() => {
      // sync once on mount in case of hydration differences
      setShow(!getCookie(COOKIE_NAME));
    }, []);

    const remember = (value) => {
      // your utils use the `{ days }` shape, so stick to it
      setCookie(COOKIE_NAME, value, { days: COOKIE_MAX_DAYS });
      setShow(false); // unmount the whole card
      // Call parent handlers
      if (value === "true" && onAccept) onAccept();
      if (value === "false" && onDecline) onDecline();
    };

    const handleAccept = () => remember("true");
    const handleDecline = () => remember("false");

    if (!show) return null;

    return (
      <div className="w-full max-w-[500px] mt-1 bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-100 rounded-4xl shadow-lg p-5 text-center">
        <h2 className="text-lg font-sans-serif font-bold mb-2 text-[#242124]">Cookie Consent</h2>
        <p className="text-sm font-san-serif mb-5 text-[#242124] leading-tight">
          Cookies help us serve you better. By using our site, you consent to cookies.{" "}
          <a href="/privacy-policy" className="underline font-sans-serif" style={{ color: "#126180" }}>
            Privacy Policy
          </a>
          ,{" "}
          <a href="/cookie-policy" className="underline font-sans-serif" style={{ color: "#126180" }}>
            Cookie Policy
          </a>{" "}
          and{" "}
          <a href="/terms-and-conditions" className="underline font-sans-serif" style={{ color: "#126180" }}>
            Terms & Conditions
          </a>
          .
        </p>
        <div className="flex justify-center gap-5">
          <button
            className="px-4 py-2 font-sans-serif rounded-full bg-[#00008b] /80 text-white text-sm"
            onClick={handleAccept}
          >
            Accept
          </button>
          <button
            className="px-4 py-2 font-sans-serif rounded-full bg-[#87ceeb] /80 text-white text-sm"
            onClick={handleDecline}
          >
            Decline
          </button>
        </div>
      </div>
    );
  }
