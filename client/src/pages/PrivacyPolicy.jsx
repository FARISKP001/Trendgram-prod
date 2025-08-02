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

const footerStyle = {
  marginTop: "2.5rem",
  textAlign: "center",
  color: "#888",
  fontSize: "1rem",
  letterSpacing: "0.02em"
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

const PrivacyPolicy = () => (
  <div style={sectionStyle}>
    <div style={headingStyle}>
      <span role="img" aria-label="check"></span> PRIVACY POLICY
    </div>
    <div style={{ color: "#444", fontSize: "1rem", marginBottom: "1.2em" }}>
      <div><strong>Effective Date:</strong> July 14, 2025</div>
      <div><strong>Website Name:</strong> TrendGram</div>
      <div><strong>Website URL:</strong> <a href="https://www.Linklie.co.in" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>www.Linklie.co.in</a></div>
    </div>
    <p>
      At TrendGram, your privacy is important to us. This policy outlines how we collect, use, and protect your personal data.
    </p>

    <div style={subheadingStyle}>1. What Information We Collect</div>
    <ul style={listStyle}>
      <li><strong>Personal Information:</strong> Name, email, phone number, etc. (only if voluntarily provided).</li>
      <li><strong>Usage Data:</strong> IP address, browser type, pages visited, and other analytics.</li>
      <li><strong>Cookies:</strong> Please see our <a href="/cookie-policy" style={{ color: "#2563eb" }}>Cookie Policy</a>.</li>
    </ul>

    <div style={subheadingStyle}>2. How We Use Your Information</div>
    <ul style={listStyle}>
      <li>To provide and improve our services.</li>
      <li>To respond to your inquiries.</li>
      <li>To analyze usage patterns and trends.</li>
    </ul>

    <div style={subheadingStyle}>3. Sharing Your Information</div>
    <p>
      We do not sell your personal information. We may share your data:
    </p>
    <ul style={listStyle}>
      <li>With third-party service providers (hosting, analytics, etc.).</li>
      <li>If required by law or to protect our rights.</li>
    </ul>

    <div style={subheadingStyle}>4. Data Retention</div>
    <p>
      We retain your data only for as long as necessary to fulfill the purposes outlined in this policy.
    </p>

    <div style={subheadingStyle}>5. Your Rights</div>
    <p>
      You may request access to, correction of, or deletion of your personal data by contacting us at <a href="mailto:your@email.com" style={{ color: "#2563eb" }}>TrendGram-contact-us@gmail.com</a>.
    </p>

    <div style={subheadingStyle}>6. Data Security</div>
    <p>
      We use reasonable security measures to protect your personal data from unauthorized access.
    </p>

    <div style={subheadingStyle}>7. Children’s Privacy</div>
    <p>
      Our services are not intended for individuals under the age of 18 without parental consent.
    </p>

    <div style={subheadingStyle}>8. Changes to This Policy</div>
    <p>
      We may update this Privacy Policy from time to time. Changes will be posted on this page with a revised effective date.
    </p>

    {/* Footer */}
    <div style={footerStyle}>
      &copy; 2025 TrendGram
    </div>
  </div>
);

export default PrivacyPolicy;