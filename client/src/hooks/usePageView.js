import { useEffect } from 'react';
import sendAnalyticsEvent from '../utils/analytics';

/**
 * Hook to send a page view event to Google Analytics
 * @param {string} pageName - The name of the page being viewed
 */
export const usePageView = (pageName) => {
  useEffect(() => {
    sendAnalyticsEvent('page_view', {
      page_title: pageName,
      timestamp: new Date().toISOString(),
    });
  }, [pageName]);
};
