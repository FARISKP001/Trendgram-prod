// src/components/AppLogo.jsx
import React from "react";

const AppLogo = ({ size = 64 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 280 280"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: "block" }}
  >
    {/* Left Figure (Pink) */}
    <ellipse cx="80" cy="90" rx="40" ry="48" fill="#FF7CA3" />
    <path
      d="M60 200 Q70 160 120 140 Q180 120 110 220 Q70 270 40 220 Q20 180 80 130"
      stroke="#FF7CA3"
      strokeWidth="20"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    {/* Right Figure (Peach) */}
    <ellipse cx="185" cy="105" rx="30" ry="35" fill="#FFC399" />
    <path
      d="M200 120 Q230 170 180 220 Q150 250 120 220 Q100 200 185 135"
      stroke="#FFC399"
      strokeWidth="18"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />

    {/* "webbit" text */}
    <text
      x="80"
      y="280"
      fontFamily="Arial Rounded MT Bold, Arial, sans-serif"
      fontWeight="bold"
      fontSize="44"
      fill="#FF7CA3"
      letterSpacing="2"
      style={{ textTransform: "lowercase" }}
    >
      webbit
    </text>
  </svg>
);

export default AppLogo;