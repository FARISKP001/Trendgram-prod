import React from 'react';

const SpeechBubble = ({ children, isSender }) => {
  const fillColor = isSender ? '#d9fdd3' : '#fff';
  const strokeColor = isSender ? '#17C4FF' : '#ccc';

  const containerStyle = {
  display: 'inline-block',
  maxWidth: '70vw',
  padding: '2px 10px', // More compact
  border: `2px solid ${strokeColor}`,
  borderRadius: '12px',
  fontSize: '0.93rem',
  lineHeight: '1.2',
  color: '#222e35',
  backgroundColor: fillColor,
  wordBreak: 'break-word',
  whiteSpace: 'pre-wrap',
};

  return <div style={containerStyle}>{children}</div>;
};

export default SpeechBubble;