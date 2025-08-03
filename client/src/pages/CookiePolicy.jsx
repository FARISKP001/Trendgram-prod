import React from 'react';

const sectionStyle = {
  background: "#f8fafc",
  borderRadius: "20px",
  boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
  padding: "2.5rem 2rem",
  maxWidth: "700px",
  margin: "2rem auto",
  color: "#222",
  fontFamily: "Segoe UI, Arial, sans-serif",
  lineHeight: 1.7,
};

const headingStyle = {
  color: "#000000",
  fontWeight: 800,
  fontSize: "2rem",
  marginBottom: "0.5rem",
  letterSpacing: "0.01em",
  display: "flex",
  alignItems: "center",
  gap: "0.6em"
};

const subheadingStyle = {
  color: "#000000",
  fontWeight: 700,
  fontSize: "1.1rem",
  marginTop: "1.5rem",
  marginBottom: "0.5rem",
};

const listStyle = {
  marginLeft: "1.5em",
  marginBottom: "1em",
};

const footerStyle = {
  marginTop: "2.5rem",
  textAlign: "center",
  color: "#888",
  fontSize: "1rem",
  letterSpacing: "0.02em"
};

const CookiePolicy = () => (
  <div style={sectionStyle}>
    <div style={headingStyle}>
      <span role="img" aria-label="check"></span> COOKIE POLICY
    </div>
    <div style={{ color: "#444", fontSize: "1rem", marginBottom: "1.2em" }}>
      <div><strong>Effective Date:</strong> July 14, 2025</div>
      <div><strong>Website Name:</strong> TrendGram</div>
      <div><strong>Website URL:</strong> <a href="https://www.Linklie.co.in" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>www.Linklie.co.in</a></div>
    </div>
    <p>
      This Cookie Policy explains how TrendGram uses cookies and similar technologies on our website.
    </p>

    <div style={subheadingStyle}>1. What Are Cookies?</div>
    <p>
      Cookies are small text files placed on your device by websites you visit. They help us improve your experience and analyze website performance.
    </p>

    <div style={subheadingStyle}>2. Types of Cookies We Use</div>
    <ul style={listStyle}>
      <li><strong>Essential Cookies:</strong> Necessary for website functionality.</li>
      <li><strong>Analytics Cookies:</strong> Help us understand how users interact with the website (e.g., Google Analytics).</li>
      <li><strong>Preference Cookies:</strong> Remember your settings and preferences.</li>
    </ul>

    <div style={subheadingStyle}>3. Managing Cookies</div>
    <p>
      You can control and manage cookies through your browser settings. Blocking some cookies may impact your experience on our website.
    </p>

    <div style={subheadingStyle}>4. Third-Party Cookies</div>
    <p>
      We may use cookies from third-party providers such as Google or Facebook. These cookies are governed by their respective privacy policies.
    </p>

    <div style={subheadingStyle}>5. Changes to This Policy</div>
    <p>
      We may revise this Cookie Policy as needed. Any changes will be posted on this page.
    </p>

    <div style={footerStyle}>
      &copy; 2025 TrendGram
    </div>
  </div>
);

export default CookiePolicy;