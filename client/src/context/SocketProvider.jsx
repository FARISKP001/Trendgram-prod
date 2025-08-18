import React, { useState, useEffect, useMemo, useRef } from 'react';
import { SocketContext } from './SocketContext';
import { io } from 'socket.io-client';

// Retrieve or create a persistent user ID for the current client.
const getUserToken = () => {
  let token = localStorage.getItem('userId');
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem('userId', token);
  }
  return token;
};

const socketURL =
  import.meta.env.VITE_SOCKET_URL ||
  (import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin);

const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  const userIdRef = useRef(getUserToken());
  const userNameRef = useRef(null);
  const deviceIdRef = useRef(null);

  useEffect(() => {
    if (!socketURL) {
      console.error('❌ Missing Socket URL');
      return;
    }

    const newSocket = io(socketURL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity, // keep retrying
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
      console.log('✅ Socket connected:', newSocket.id);

      if (userIdRef.current && (userNameRef.current || deviceIdRef.current)) {
        newSocket.emit('register_user', {
          userId: userIdRef.current,
          deviceId: deviceIdRef.current,
          userName: userNameRef.current,
        });
      }
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      console.warn('⚠️ Socket disconnected');
    });

    newSocket.on('connect_error', (err) => {
      console.error('❌ Socket connection error:', err.message);
    });

    setSocket(newSocket);

    return () => {
      if (newSocket.connected) newSocket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socketURL]);

  const value = useMemo(
    () => ({
      socket,
      isConnected,
      // Expose setters so HomePage or ChatBox can update refs when username/deviceId changes
      setUserContext: ({ userName, deviceId }) => {
        userNameRef.current = userName;
        deviceIdRef.current = deviceId;
      },
    }),
    [socket, isConnected]
  );

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};

export default SocketProvider;
