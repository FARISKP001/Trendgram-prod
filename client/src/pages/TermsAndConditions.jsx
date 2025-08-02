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

const TermsAndConditions = () => (
  <div style={sectionStyle}>
    <div style={headingStyle}>
      <span role="img" aria-label="terms"></span> TERMS AND CONDITIONS
    </div>
    <div style={{ color: "#444", fontSize: "1rem", marginBottom: "1.2em" }}>
      <div><strong>Effective Date:</strong> July 14, 2025</div>
      <div><strong>Website Name:</strong> webbit</div>
      <div><strong>Website URL:</strong> <a href="https://www.Linklie.co.in" target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb", textDecoration: "underline" }}>www.Linklie.co.in</a></div>
    </div>
    <p>
      Welcome to webbit! By accessing or using our website, you agree to be bound by these Terms of Use. If you do not agree, please do not use our website.
    </p>

    <div style={subheadingStyle}>1. Use of the Website</div>
    <ul style={listStyle}>
      <li>You must be at least 18 years of age or have parental consent to use this website.</li>
      <li>You agree not to use the website for any unlawful purpose or in a way that may harm or interfere with others’ use of the website.</li>
    </ul>

    <div style={subheadingStyle}>2. Intellectual Property</div>
    <p>
      All content, trademarks, logos, and other intellectual property displayed on this website are the property of webbit or its licensors. You may not use or reproduce them without prior written permission.
    </p>

    <div style={subheadingStyle}>3. User Content</div>
    <p>
      If you post or upload any content, you grant us a non-exclusive, royalty-free, worldwide license to use, display, and reproduce such content on our platform.
    </p>

    <div style={subheadingStyle}>4. Third-Party Links</div>
    <p>
      Our website may contain links to third-party websites. We are not responsible for the content or privacy practices of those websites.
    </p>

    <div style={subheadingStyle}>5. Limitation of Liability</div>
    <p>
      We do not guarantee that our website will be error-free or uninterrupted. We are not liable for any damages arising from the use or inability to use the website.
    </p>

    <div style={subheadingStyle}>6. Termination</div>
    <p>
      We reserve the right to suspend or terminate your access to our website at our discretion, without notice.
    </p>

    <div style={subheadingStyle}>7. Governing Law</div>
    <p>
      These Terms shall be governed by and construed in accordance with the laws of India. Disputes shall be subject to the jurisdiction of the courts of Kerala, India.
    </p>

    <div style={footerStyle}>
      &copy; 2025 webbit
    </div>
  </div>
);

export default TermsAndConditions;