"use client";

import { useState } from "react";

/// The product's slider. NOT the browser's default rounded-pill range input.
/// A flat ink-on-canvas track with a pink fill, a sharp square thumb that holds
/// a pink core and lifts on drag, optional tick notches, and a mono value bubble
/// that pops above the thumb while dragging. A real (visually hidden) range input
/// sits on top so keyboard, touch, and screen-reader behavior stay native; the
/// painted layer below is purely visual. Use this anywhere a value is dialed on
/// a continuous range (zoom, stake, speedup, allocation).
export function RangeSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  label,
  hint,
  ticks,
  disabled,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /// Formats the readout + drag bubble (e.g. (v) => `${v.toFixed(1)}x`).
  format?: (v: number) => string;
  /// Optional caps-label rendered above the track, with the live value on the right.
  label?: string;
  /// Optional small note under the label (e.g. min/max meaning).
  hint?: string;
  /// Number of evenly spaced tick notches drawn on the track (including the ends).
  ticks?: number;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const span = max - min;
  const pct = span > 0 ? ((value - min) / span) * 100 : 0;
  const at = Math.max(0, Math.min(100, pct));
  const show = format ? format(value) : String(value);
  const active = (dragging || focused) && !disabled;

  return (
    <div className={`w-full select-none ${disabled ? "opacity-60" : ""}`}>
      {label ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{label}</span>
          <span className="font-mono text-[12px] tabular-nums text-ink">{show}</span>
        </div>
      ) : null}

      <div className="relative h-6">
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 border border-[color:var(--hairline-strong)] bg-canvas-2">
          {/* Pink fill to the thumb */}
          <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${at}%` }} />
        </div>

        {/* Tick notches sitting on the track */}
        {ticks && ticks > 1
          ? Array.from({ length: ticks }, (_, i) => {
              const t = (i / (ticks - 1)) * 100;
              return (
                <span
                  key={i}
                  aria-hidden
                  className="absolute top-1/2 h-[10px] w-px -translate-x-1/2 -translate-y-1/2 bg-[color:var(--hairline-strong)]"
                  style={{ left: `${t}%` }}
                />
              );
            })
          : null}

        {/* Square thumb with a pink core; lifts on drag/focus */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-1/2 z-10 flex h-4 w-4 items-center justify-center border border-ink bg-canvas"
          style={{
            left: `${at}%`,
            transform: `translate(-50%, -50%) ${active ? "scale(1.2)" : "scale(1)"}`,
            transition: "transform 120ms ease-out",
            outline: focused ? "2px solid var(--ink)" : "none",
            outlineOffset: 2,
          }}
        >
          <span className="h-1.5 w-1.5 bg-accent" />
        </div>

        {/* Value bubble while dragging */}
        {dragging ? (
          <div
            aria-hidden
            className="pointer-events-none absolute -top-4 z-20 -translate-x-1/2 whitespace-nowrap border border-ink bg-ink px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-canvas"
            style={{ left: `${at}%` }}
          >
            {show}
          </div>
        ) : null}

        {/* Real range input on top: handles pointer, touch, keyboard, a11y. */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel ?? label}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerDown={() => setDragging(true)}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            setDragging(false);
          }}
          className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0 disabled:cursor-not-allowed"
        />
      </div>

      {hint ? <p className="mt-1.5 font-mono text-[10px] leading-snug text-ink-3">{hint}</p> : null}
    </div>
  );
}
