import React from 'react';

const SpeechBubble = ({ children, isSender }) => {
  const fillColor = isSender ? '#d9fdd3' : '#ffffff';
  const textColor = '#222e35';
  const borderColor = isSender ? '#17C4FF' : '#ccc';

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
    boxShadow: '0 1px 1.5px rgba(0,0,0,0.1)',
  };

  return <div style={containerStyle}>{children}</div>;
};

export default SpeechBubble;