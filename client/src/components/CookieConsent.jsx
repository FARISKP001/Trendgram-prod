import React, { useState, useEffect } from "react";
import { getCookie, setCookie } from "../utils/cookies.js";

const COOKIE_NAME = "cookieConsentGiven";
const COOKIE_MAX_DAYS = 365;

export default function CookieConsent() {
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
  };

  const handleAccept = () => remember("true");
  const handleDecline = () => remember("false");

  if (!show) return null;

  return (
    <div className="cookie-inline" role="region" aria-label="Cookie consent">
      <p className="text-center text-[15px] leading-6 text-[#6b7280]">
        Cookies help us serve you better. By using our site, you consent to cookies.{" "}
        <a href="/privacy-policy" className="underline" style={{ color: "#ff7f50" }}>
          Privacy Policy
        </a>
        ,{" "}
        <a href="/cookie-policy" className="underline" style={{ color: "#ff7f50" }}>
          Cookie Policy
        </a>{" "}
        and{" "}
        <a href="/terms-and-conditions" className="underline" style={{ color: "#ff7f50" }}>
          Terms & Conditions
        </a>
        .
      </p>

      <div className="mt-3 flex justify-center gap-2">
        <button
          type="button"
          onClick={handleAccept}
          className="px-4 py-1.5 rounded-full font-semibold border transition-colors
                     bg-[#9ab973] hover:bg-[#9ab973]/80 text-white"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={handleDecline}
          className="px-4 py-1.5 rounded-full font-semibold border transition-colors
                     bg-[#e25822] hover:bg-[#e25822]/80 text-white"
        >
          No
        </button>
      </div>
    </div>
  );
}
