// useKeyboardVisible.js
import { useEffect, useState, useRef } from 'react';

export default function useKeyboardVisible() {
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const initialHeightRef = useRef(null);

  useEffect(() => {
    const threshold = 150; // px difference to consider keyboard visible
    
    // Initialize height after a brief delay (allows page to fully load)
    const initTimer = setTimeout(() => {
      initialHeightRef.current = window.innerHeight;
    }, 100);

    const handleResize = () => {
      if (initialHeightRef.current === null) {
        initialHeightRef.current = window.innerHeight;
        return;
      }
      
      // Recalculate if orientation changed
      const currentHeight = window.innerHeight;
      if (Math.abs(currentHeight - initialHeightRef.current) > 200) {
        initialHeightRef.current = currentHeight;
        setKeyboardVisible(false);
        return;
      }
      
      const heightDiff = initialHeightRef.current - currentHeight;
      setKeyboardVisible(heightDiff > threshold);
    };

    const handleOrientationChange = () => {
      setTimeout(() => {
        initialHeightRef.current = window.innerHeight;
        setKeyboardVisible(false);
      }, 100);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      clearTimeout(initTimer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, []);

  return keyboardVisible;
}
