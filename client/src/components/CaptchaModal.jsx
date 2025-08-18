import React, { useEffect, useRef, useState } from 'react';

const CaptchaModal = ({ onSuccess, siteKey, onClose }) => {
  const ref = useRef(null);
  const widgetId = useRef(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    // Bail out if no siteKey
    if (!siteKey) {
      setLoadError('⚠️ Captcha siteKey not configured. Please check VITE_CF_SITE_KEY.');
      return;
    }

    // Bail out if Turnstile script not ready
    if (!window.turnstile || !ref.current) return;

    try {
      if (!widgetId.current) {
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          callback: (token) => onSuccess(token),
        });
      }
    } catch (err) {
      console.error('Captcha render error:', err);
      setLoadError('⚠️ Failed to render captcha widget.');
    }

    return () => {
      if (widgetId.current && ref.current) {
        ref.current.innerHTML = '';
        widgetId.current = null;
      }
    };
  }, [siteKey, onSuccess]);

  // 🔄 Auto-fallback after 10 seconds if widget never loads
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!widgetId.current && !loadError) {
        setLoadError('⚠️ Captcha failed to load. Please refresh and try again.');
      }
    }, 10000);
    return () => clearTimeout(timer);
  }, [loadError]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-lg max-w-sm w-full text-center">
        {/* === Error or fallback message === */}
        {loadError ? (
          <p className="text-red-600 font-semibold">{loadError}</p>
        ) : (
          <div ref={ref} className="flex justify-center" />
        )}

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
