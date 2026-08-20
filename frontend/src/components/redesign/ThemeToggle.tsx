"use client";

import { useEffect, useState } from "react";
import { applyTheme, getSetting, setSetting } from "@/lib/profiles";

type ThemeToggleProps = {
  className?: string;
};

/**
 * Compact theme control for the shared chrome. The icon communicates the
 * action (sun in dark mode, moon in light mode) while the accessible label
 * explains the destination state to screen readers and tooltips.
 */
export function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const [dark, setDark] = useState(true);

  useEffect(() => {
    const stored = getSetting("theme", "dark");
    const nextDark = stored !== "light";
    setDark(nextDark);
    applyTheme(nextDark ? "dark" : "light");
  }, []);

  function toggle() {
    const nextDark = !dark;
    setDark(nextDark);
    setSetting("theme", nextDark ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={dark}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center border border-[color:var(--hairline-strong)] bg-canvas text-ink transition-colors hover:bg-canvas-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${className}`}
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v3M12 18.5v3M4.8 4.8l2.1 2.1M17.1 17.1l2.1 2.1M2.5 12h3M18.5 12h3M4.8 19.2l2.1-2.1M17.1 6.9l2.1-2.1" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square" strokeLinejoin="miter">
      <path d="M19.5 14.4A7.7 7.7 0 0 1 9.6 4.5a7.8 7.8 0 1 0 9.9 9.9Z" />
    </svg>
  );
}
