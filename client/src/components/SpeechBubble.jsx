import React from 'react';

const SpeechBubble = ({ children, isSender, theme = 'light' }) => {
  const isDark = theme === 'dark';
  const fillColor = isSender
    ? (isDark ? '#2d5a2d' : '#d9fdd3')
    : (isDark ? '#374151' : '#ffffff');
  const textColor = isDark ? '#f3f4f6' : '#222e35';
  const borderColor = isSender
    ? (isDark ? '#3b82f6' : '#17C4FF')
    : (isDark ? '#6b7280' : '#ccc');

  const containerStyle = {
    display: 'inline-block',
    padding: '8px 14px',
    borderRadius: '18px',
    fontSize: '1rem',
    lineHeight: '1.4',
    color: textColor,
    backgroundColor: fillColor,
    border: `1.5px solid ${borderColor}`,
    maxWidth: '75vw',
    minWidth: '40px',
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
    boxShadow: isDark ? '0 1px 1.5px rgba(0,0,0,0.3)' : '0 1px 1.5px rgba(0,0,0,0.1)',
  };

  return <div style={containerStyle}>{children}</div>;
};

export default SpeechBubble;