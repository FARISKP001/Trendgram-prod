import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './main.css';

import SocketProvider from './context/SocketProvider'; // ✅ Import the provider

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SocketProvider> {/* ✅ Provide context to the app */}
      <App />
    </SocketProvider>
  </React.StrictMode>
);
