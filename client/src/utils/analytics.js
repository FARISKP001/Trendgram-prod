// src/utils/analytics.js

/**
 * Fires a Google Analytics 4 event (gtag).
 * @param {string} eventName - The name of the event (e.g., 'chat_started').
 * @param {object} params - Parameters to send with the event.
 */
const sendAnalyticsEvent = (eventName, params = {}) => {
  if (window.gtag) {
    window.gtag('event', eventName, params);
  } else {
    console.warn('📉 Analytics not initialized: ', eventName, params);
  }
};

export default sendAnalyticsEvent;
