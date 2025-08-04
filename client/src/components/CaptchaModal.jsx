import React, { useEffect, useRef } from 'react';

const CaptchaModal = ({ visible, onSuccess, siteKey }) => {
  const ref = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    if (!visible || !siteKey || !window.turnstile || !ref.current) return;

    // ✅ Only render if not already rendered
    if (!widgetId.current) {
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (token) => onSuccess(token),
      });
    }

    return () => {
      // ✅ Optional cleanup on unmount
      if (widgetId.current && ref.current) {
        ref.current.innerHTML = '';
        widgetId.current = null;
      }
    };
  }, [visible, siteKey, onSuccess]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 p-5 rounded-lg">
        <div ref={ref} />
      </div>
    </div>
  );
};

export default CaptchaModal;
