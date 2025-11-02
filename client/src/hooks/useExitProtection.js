import { useEffect, useRef } from 'react';

const useExitProtection = ({
  enabled = false,
  onRefresh,
  onBack,
  showExitConfirmToast,
}) => {
  const statePushedRef = useRef(false);
  const isProcessingRef = useRef(false);
  const timeoutRef = useRef(null);
  const isProgrammaticBackRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      // Reset when disabled
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      isProcessingRef.current = false;
      return;
    }

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

    const handlePopState = (e) => {
      // Skip if this is a programmatic back (from cancellation)
      if (isProgrammaticBackRef.current) {
        isProgrammaticBackRef.current = false;
        return;
      }

      // Prevent multiple simultaneous popstate handlers
      if (isProcessingRef.current) {
        console.log('[useExitProtection] Popstate already processing, ignoring');
        // Still push state back to prevent navigation even if processing
        window.history.pushState(null, '', window.location.href);
        return;
      }

      isProcessingRef.current = true;

      // Immediately push state back to prevent navigation
      // This cancels the back button press by adding the state back
      window.history.pushState(null, '', window.location.href);

      if (isMobile && typeof showExitConfirmToast === 'function') {
        // Custom confirmation toast/modal on mobile
        // The toast's onConfirm callback will call onBack when user confirms
        showExitConfirmToast(() => {
          // User confirmed - navigate away
          // onBack uses navigate with replace: true, which replaces current entry
          isProcessingRef.current = false;
          if (onBack) {
            onBack();
          }
        });
        // Note: If user cancels (dismisses toast), the state we pushed keeps them on page
        // We'll reset the flag after a delay, but don't pop history to avoid loops
        // The pushed state will be replaced when user eventually navigates away or confirms
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          if (isProcessingRef.current) {
            // Toast was dismissed without confirming - user stays on page
            // Don't pop history here as it could cause loops - just reset flag
            isProcessingRef.current = false;
          }
        }, 3000); // Reset after 3 seconds if toast wasn't interacted with
      } else {
        // Desktop confirmation via `confirm`
        setTimeout(() => {
          const confirmLeave = window.confirm('⚠️ Are you sure you want to leave the chat?');
          if (confirmLeave && onBack) {
            // Call onBack when user confirms - this will navigate away
            // onBack uses navigate with replace: true, which replaces the entry we just pushed
            onBack();
            isProcessingRef.current = false;
          } else {
            // User cancelled - pop the state we just pushed to prevent history stack growth
            // Mark as programmatic to avoid triggering popstate handler again
            isProgrammaticBackRef.current = true;
            try {
              window.history.back();
            } catch (error) {
              console.warn('[useExitProtection] Could not pop history state:', error);
              isProgrammaticBackRef.current = false;
            }
            isProcessingRef.current = false;
          }
        }, 0);
      }
    };

    // Only push state once when enabled, not on every effect run
    // Use replaceState to avoid creating multiple history entries
    if (!statePushedRef.current) {
      // Push state only if we're not already at the root (to avoid pushing on initial load)
      // Check if history length is > 1 (meaning we have previous history)
      if (window.history.length > 1) {
        window.history.pushState(null, '', window.location.href);
      } else {
        // First entry - use replaceState
        window.history.replaceState(null, '', window.location.href);
      }
      statePushedRef.current = true;
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('unload', handleUnload);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('unload', handleUnload);
      window.removeEventListener('popstate', handlePopState);
      // Reset flags and cleanup timeout when disabled
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      isProcessingRef.current = false;
    };
  }, [enabled, onRefresh, onBack, showExitConfirmToast]);

  // Reset statePushedRef when disabled
  useEffect(() => {
    if (!enabled) {
      statePushedRef.current = false;
    }
  }, [enabled]);

  return null;
};

export default useExitProtection;
