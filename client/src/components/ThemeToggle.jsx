import React from "react";
import useTheme from "../hooks/useTheme";
import "./ThemeToggle.css";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <label className="theme-toggle">
      <input
        type="checkbox"
        onChange={toggleTheme}
        checked={theme === "dark"}
        aria-label="Toggle dark mode"
      />
      <span className="slider"></span>
    </label>
  );
}
