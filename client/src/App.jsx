import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import CookieConsent from './components/CookieConsent';
const HomePage = lazy(() => import('./pages/HomePage'));
const ChatBox = lazy(() => import('./components/ChatBox'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const CookiePolicy = lazy(() => import('./pages/CookiePolicy'));
const TermsAndConditions = lazy(() => import('./pages/TermsAndConditions'));

const App = () => {
  return (
    <Router>
      {/* <-- Render here so it overlays every page */}
      <CookieConsent />
      <Suspense fallback={<div>Loading...</div>}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/chatbox" element={<ChatBox />} />
          <Route path="/privacy-policy" element={<PrivacyPolicy />} />
          <Route path="/cookie-policy" element={<CookiePolicy />} />
          <Route path="/terms-and-conditions" element={<TermsAndConditions />} />
        </Routes>
      </Suspense>
    </Router>
  );
};

export default App;
