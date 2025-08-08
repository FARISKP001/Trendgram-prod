import React, { useState, useEffect, useMemo } from 'react';
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
  (import.meta.env.DEV ? 'http://localhost:5000' : '');

const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!socketURL) {
      console.error('❌ Missing Socket URL');
      return;
    }

    const userId = getUserToken();
    const newSocket = io(socketURL, {
      transports: ['websocket'],
      auth: { userId },
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      setIsConnected(true);
      console.log('✅ Socket connected:', newSocket.id);
    });

    newSocket.on('disconnect', () => {
      setIsConnected(false);
      console.warn('⚠️ Socket disconnected');
    });

    newSocket.on('connect_error', (err) => {
      console.error('❌ Socket connection error:', err.message);
    });

    setSocket(newSocket);
    return () => newSocket.disconnect();
  }, []);

  const value = useMemo(() => ({ socket, isConnected }), [socket, isConnected]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
};

export default SocketProvider;
