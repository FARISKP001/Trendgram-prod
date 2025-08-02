import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import HomePage from './pages/HomePage';
import ChatBox from './components/ChatBox';
import PrivacyPolicy from './pages/PrivacyPolicy';
import CookiePolicy from './pages/CookiePolicy';
import TermsAndConditions from './pages/TermsAndConditions';
import CookieConsent from './components/CookieConsent';

const App = () => {
  return (
    <Router>
      {/* <-- Render here so it overlays every page */}
      <CookieConsent />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/chatbox" element={<ChatBox />} />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/cookie-policy" element={<CookiePolicy />} />
        <Route path="/terms-and-conditions" element={<TermsAndConditions />} />
      </Routes>
    </Router>
  );
};

export default App;
