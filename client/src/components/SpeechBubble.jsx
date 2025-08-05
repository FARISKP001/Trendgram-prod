import React from 'react';

const SpeechBubble = ({ children, isSender }) => {
  const fillColor = isSender ? '#d9fdd3' : '#fff';
  const strokeColor = isSender ? '#17C4FF' : '#ccc';

  const containerStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    maxWidth: '75vw',
    padding: '3px 6px',
    border: `2px solid ${strokeColor}`,
    borderRadius: '12px',
    fontSize: '0.95rem',
    lineHeight: '1.25',
    color: '#222e35',
    backgroundColor: fillColor,
    position: 'relative',
  };

  const svgStyle = {
    flexShrink: 0,
    width: 14,
    height: 28,
  };

  return (
    <div style={containerStyle}>
      {!isSender && (
        <svg
          style={{ ...svgStyle, marginRight: 6 }}
          viewBox="0 0 14 28"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <polygon points="14,0 0,14 14,28" fill={fillColor} stroke={strokeColor} strokeWidth="2" />
        </svg>
      )}
      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{children}</div>
      {isSender && (
        <svg
          style={{ ...svgStyle, marginLeft: 6 }}
          viewBox="0 0 14 28"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <polygon points="0,0 14,14 0,28" fill={fillColor} stroke={strokeColor} strokeWidth="2" />
        </svg>
      )}
    </div>
  );
};

export default SpeechBubble;