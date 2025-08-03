import React from 'react';
import logo from '../assets/tg_logo.png';

const WebbitLogo = ({ size = 180 }) => (
  <img
    src={logo}
    width={size}
    height={size}
    alt="TrendGram logo"
    className="object-contain shadow-xl bg-white rounded-2xl"
    style={{ display: 'block' }}
  />
);

export default WebbitLogo;
