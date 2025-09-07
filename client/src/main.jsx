import './main.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SocketProvider from './context/SocketProvider';
import { ThemeProvider } from './context/ThemeContext';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SocketProvider>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </SocketProvider>
  </React.StrictMode>
);
