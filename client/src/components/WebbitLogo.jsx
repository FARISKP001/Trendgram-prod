import React from 'react';
import logo from '../assets/tg_logo.jpeg';

const WebbitLogo = ({ size = 80 }) => (
  <img
    src={logo}
    width={size}
    height={size}
    alt="TrendGram logo"
    className="rounded-full border-2 border-sky-400 shadow-lg object-cover"
    style={{ background: '#fff' }}
  />
);

export default WebbitLogo;
