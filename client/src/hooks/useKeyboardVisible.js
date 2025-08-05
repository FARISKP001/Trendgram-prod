// useKeyboardVisible.js
import { useEffect, useState } from 'react';

export default function useKeyboardVisible() {
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const threshold = 150; // px difference to consider keyboard visible
    let initialHeight = window.innerHeight;

    const handleResize = () => {
      const heightDiff = initialHeight - window.innerHeight;
      setKeyboardVisible(heightDiff > threshold);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return keyboardVisible;
}
