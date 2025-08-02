// src/hooks/useAnalytics.js
import { useEffect } from 'react';

export const usePageView = (pageName) => {
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      window.gtag('event', 'page_view', {
        page_title: pageName,
        page_location: window.location.href,
      });
    } else {
      console.log(`[Mock Analytics] Page View: ${pageName}`);
    }
  }, [pageName]);
};
