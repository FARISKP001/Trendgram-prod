import { useEffect, useRef, useState } from 'react';
import useSocketContext from '../context/useSocketContext';

/**
 * Custom hook for matchmaking with polling
 */
export const useMatchmaking = () => {
  const { connectToMatch } = useSocketContext();
  const [isMatching, setIsMatching] = useState(false);
  const [matchStatus, setMatchStatus] = useState('');
  const pollingIntervalRef = useRef(null);

  const startMatchmaking = async (userId, userName, deviceId, emotion = null, language = null, mode = null) => {
    console.log("🟡 [useMatchmaking] startMatchmaking called", { userId, userName, emotion, language, mode });
    setIsMatching(true);
    setMatchStatus('Searching for partner...');

    const pollMatch = async () => {
      try {
        console.log("🟡 [useMatchmaking] Polling matchmaking API...");
        const result = await connectToMatch(userId, userName, deviceId, emotion, language, mode);
        console.log("🟡 [useMatchmaking] Poll result:", result);
        
        if (result && result.matched) {
          // Match found, stop polling
          console.log("✅ [useMatchmaking] Match found! Stopping polling.", result);
          
          // Verify that partner_found event will be/has been dispatched
          // connectToMatch dispatches the event, but add a small delay to ensure it's processed
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          setIsMatching(false);
          setMatchStatus('');
          
          // Double-check: If event wasn't dispatched by connectToMatch (shouldn't happen), log warning
          // The partner_found event should have been dispatched by connectToMatch in SocketProvider
          console.log("✅ [useMatchmaking] Match confirmed, partner_found event should be dispatched by connectToMatch");
          
          return result;
        } else {
          // Still waiting
          console.log("⏳ [useMatchmaking] Still waiting:", result?.message || 'No match yet');
          setMatchStatus(result?.message || 'Waiting for partner...');
          return null;
        }
      } catch (error) {
        console.error('🔴 [useMatchmaking] Error:', error);
        setIsMatching(false);
        setMatchStatus('Error: ' + error.message);
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        throw error;
      }
    };

    // Start polling immediately
    const firstResult = await pollMatch();
    if (firstResult?.matched) {
      return firstResult;
    }

    // Continue polling every 2 seconds
    pollingIntervalRef.current = setInterval(async () => {
      const result = await pollMatch();
      if (result?.matched) {
        // Match found during polling - stop polling
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        setIsMatching(false);
        setMatchStatus('');
        // Don't return here - the partner_found event will handle navigation
      }
    }, 2000);

    // Timeout after 60 seconds
    setTimeout(() => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      setIsMatching(false);
      setMatchStatus('No partner found. Please try again.');
    }, 60000);
  };

  const stopMatchmaking = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setIsMatching(false);
    setMatchStatus('');
  };

  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, []);

  return {
    startMatchmaking,
    stopMatchmaking,
    isMatching,
    matchStatus,
  };
};

