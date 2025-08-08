import React from 'react';
import logo from '../assets/tg_logo.png';

const WebbitLogo = ({ size = 64, style = {} }) => (
  <img
    src={logo}
    alt="TrendGram logo"
    style={{
      width: `${size}px`,
      height: `${size}px`,
      objectFit: 'contain',
      display: 'block',
      ...style,
    }}
    className="bg-white"
  />
);

export default WebbitLogo;