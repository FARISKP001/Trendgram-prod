import { useEffect } from 'react';

const useExitProtection = ({
  enabled = false,
  onRefresh,
  onBack,
  showExitConfirmToast,
}) => {
  useEffect(() => {
    if (!enabled) return;

    const isMobile = window.matchMedia('(max-width: 768px)').matches;


    const handleBeforeUnload = (e) => {
      if (isMobile) {
        // Prevent tab close/refresh on mobile without confirmation
        e.preventDefault();
        e.returnValue = '';
      } else {
        // Desktop shows native confirmation dialog
        e.preventDefault();
        e.returnValue = '';
      }
    };

    const handleUnload = () => {
      // Called when the page is unloading
      if (onRefresh) onRefresh();
    };

    const handlePopState = () => {
      // Immediately push state so we stay on the site regardless of user choice
      window.history.pushState(null, '', window.location.href);

      if (isMobile && typeof showExitConfirmToast === 'function') {
        // Custom confirmation toast/modal on mobile
        showExitConfirmToast();
      } else {
        // Desktop confirmation via `confirm`
        const confirmLeave = window.confirm('⚠️ Are you sure you want to leave the chat?');
        if (confirmLeave && onBack) {
          onBack();

        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('unload', handleUnload);
    window.addEventListener('popstate', handlePopState);
    window.history.pushState(null, '', window.location.href); // Prevent back nav by default

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleUnload);
      window.removeEventListener('popstate', handlePopState);
    };
  }, [enabled, onRefresh, onBack, showExitConfirmToast]);

  return null;
};

export default useExitProtection;
