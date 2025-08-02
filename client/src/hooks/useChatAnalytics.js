import { useEffect } from 'react';
import sendAnalyticsEvent from '../utils/analytics';

/**
 * Tracks chat session analytics: start, message sent, report, and end.
 * @param {Object} config
 * @param {string} config.userId - Current user's ID
 * @param {string} config.userName - Current user's name
 * @param {string|null} config.partnerId - Connected partner's ID (if any)
 * @param {string} config.chatState - Current state of the chat
 * @param {boolean} config.enabled - Whether to enable analytics tracking
 */
const useChatAnalytics = ({ userId, userName, partnerId, chatState, enabled }) => {
  // Automatically track chat start
  useEffect(() => {
    if (enabled && chatState === 'chatting' && partnerId) {
      trackSessionStart();
    }
  }, [enabled, chatState, partnerId]);

  // Automatically track chat end
  useEffect(() => {
    if (enabled && chatState === 'disconnected') {
      trackSessionEnd();
    }
  }, [enabled, chatState, partnerId]);

  const trackSessionStart = () => {
    if (!enabled || !partnerId) return;
    sendAnalyticsEvent('chat_started', {
      user_id: userId,
      user_name: userName,
      partner_id: partnerId,
      timestamp: new Date().toISOString(),
    });
  };

  const trackSessionEnd = () => {
    if (!enabled || !partnerId) return;
    sendAnalyticsEvent('chat_ended', {
      user_id: userId,
      user_name: userName,
      partner_id: partnerId,
      timestamp: new Date().toISOString(),
    });
  };

  const trackMessageSent = (message) => {
    if (!enabled || !partnerId) return;
    sendAnalyticsEvent('message_sent', {
      user_id: userId,
      user_name: userName,
      partner_id: partnerId,
      message,
      timestamp: new Date().toISOString(),
    });
  };

  const trackUserReported = () => {
    if (!enabled || !partnerId) return;
    sendAnalyticsEvent('user_reported', {
      reporter_id: userId,
      reporter_name: userName,
      reported_id: partnerId,
      timestamp: new Date().toISOString(),
    });
  };

  return {
    trackSessionStart,
    trackSessionEnd,
    trackMessageSent,
    trackUserReported,
  };
};

export default useChatAnalytics;
