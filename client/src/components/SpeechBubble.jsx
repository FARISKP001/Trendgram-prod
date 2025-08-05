import React from 'react';

const SpeechBubble = ({ children, isSender }) => {
  const fillColor = isSender ? '#d9fdd3' : '#fff';
  const strokeColor = isSender ? '#17C4FF' : '#ccc';

  const containerStyle = {
    display: 'inline-block',
    maxWidth: '70vw',
    padding: '8px 12px',
    border: `2px solid ${strokeColor}`,
    borderRadius: '12px',
    fontSize: '0.9rem',
    lineHeight: '1.4',
    color: '#222e35',
    backgroundColor: fillColor,
    wordBreak: 'break-word',
    whiteSpace: 'pre-wrap',
  };

  return <div style={containerStyle}>{children}</div>;
};

export default SpeechBubble;