import React from 'react';

const WebbitLogo = ({ size = 100, color = '#00008b', color2 = '#9ab973', fillColor = '#ffd700' }) => {
  const center = size / 2;
  const radius = size / 2 - 4;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer Circle */}
      <circle
        cx="100"
        cy="100"
        r="96"
        stroke={color2}
        strokeWidth="8"
        fill={fillColor}
      />

      {/* W base strokes */}
      <path
        d="M30,60 L60,160 L90,80 L120,160 L150,60"
        fill="none"
        stroke={color}
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Crisscross lines inside W area */}
      <g stroke={color} strokeWidth="3" opacity="0.9">
        <line x1="30" y1="60" x2="150" y2="160" />
        <line x1="40" y1="50" x2="120" y2="170" />
        <line x1="60" y1="60" x2="140" y2="140" />
        <line x1="70" y1="90" x2="130" y2="120" />
        <line x1="80" y1="130" x2="100" y2="80" />
        <line x1="90" y1="70" x2="110" y2="150" />
        <line x1="100" y1="60" x2="90" y2="160" />
        <line x1="110" y1="80" x2="70" y2="140" />
        <line x1="60" y1="120" x2="140" y2="100" />
      </g>
    </svg>
  );
};

export default WebbitLogo;
