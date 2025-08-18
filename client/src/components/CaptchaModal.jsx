import React, { useEffect, useRef } from 'react';

const CaptchaModal = ({ onSuccess, siteKey, onClose }) => {
  const ref = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    if (!siteKey || !window.turnstile || !ref.current) return;

    if (!widgetId.current) {
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (token) => onSuccess(token),
      });
    }

    return () => {
      if (widgetId.current && ref.current) {
        ref.current.innerHTML = '';
        widgetId.current = null;
      }
    };
  }, [siteKey, onSuccess]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg max-w-sm w-full text-center">
        {/* === Fallback if no siteKey configured === */}
        {!siteKey && (
          <p className="text-red-600 font-semibold">
            ⚠️ Captcha siteKey not configured.<br />
            Please check <code>VITE_CF_SITE_KEY</code> in your environment.
          </p>
        )}

        {/* === Fallback if script not loaded yet === */}
        {siteKey && !window.turnstile && (
          <p className="text-yellow-600 font-semibold">
            ⏳ Loading captcha… please wait
          </p>
        )}

        {/* === Actual Captcha widget === */}
        {siteKey && <div ref={ref} className="flex justify-center" />}

        {/* Optional close button */}
        {onClose && (
          <button
            onClick={onClose}
            className="mt-4 px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
};

export default CaptchaModal;
