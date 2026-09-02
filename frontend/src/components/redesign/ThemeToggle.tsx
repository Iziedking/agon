"use client";

import { useEffect, useState } from "react";
import { applyTheme, getSetting, setSetting } from "@/lib/profiles";
import { isDarkTheme, nextThemePreference, normalizeThemePreference, type ThemePreference } from "@/lib/theme";

type ThemeToggleProps = {
  className?: string;
};

/**
 * Compact theme control for the shared chrome. The icon communicates the
 * action (sun in dark mode, moon in light mode) while the accessible label
 * explains the destination state to screen readers and tooltips.
 */
export function ThemeToggle({ className = "" }: ThemeToggleProps) {
  const [preference, setPreference] = useState<ThemePreference>("auto");
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const nextPreference = normalizeThemePreference(getSetting("theme", "auto"));
      setPreference(nextPreference);
      setDark(isDarkTheme(nextPreference, media.matches));
      applyTheme(nextPreference);
    };
    sync();
    media.addEventListener?.("change", sync);
    return () => media.removeEventListener?.("change", sync);
  }, []);

  function toggle() {
    const nextPreference = nextThemePreference(preference);
    setPreference(nextPreference);
    const nextDark = isDarkTheme(nextPreference, window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(nextDark);
    setSetting("theme", nextPreference);
  }

  const modeLabel = preference === "auto" ? "DAYLIGHT" : preference.toUpperCase();
  const label = preference === "auto"
    ? `Theme: daylight mode, currently ${dark ? "dark" : "light"}. Switch to dark mode.`
    : `Theme: ${modeLabel.toLowerCase()}. Switch to ${nextThemePreference(preference)} mode.`;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={`${modeLabel} theme`}
      aria-pressed={preference === "dark"}
      className={`inline-flex h-11 w-11 min-h-11 min-w-11 shrink-0 items-center justify-center border border-[color:var(--hairline-strong)] bg-canvas text-ink transition-colors hover:bg-canvas-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ${className}`}
    >
      {preference === "auto" ? <DaylightIcon dark={dark} /> : dark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

function DaylightIcon({ dark }: { dark: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="square">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v3M12 18.5v3M4.8 4.8l2.1 2.1M17.1 17.1l2.1 2.1M2.5 12h3M18.5 12h3" />
      <path d={dark ? "M17.5 4.8a6.8 6.8 0 0 0 2.2 12.8 7.5 7.5 0 0 1-2.2-12.8Z" : "M17.5 4.8a6.8 6.8 0 0 1 2.2 12.8 7.5 7.5 0 0 0-2.2-12.8Z"} />
    </svg>
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
