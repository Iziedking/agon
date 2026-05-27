"use client";

/// Static-but-alive backdrop for the landing hero. Two slowly-rotating
/// concentric wireframe rings + a pulsing dot at the center, all in ink at
/// low alpha so the wordmark on top stays the focal point.
///
/// Implemented as inline SVG with CSS animations — no canvas, no video, no
/// network requests, no LCP regression. The whole thing weighs maybe 2 KB.
/// `prefers-reduced-motion` disables the spin and pulse.
export function KineticArena() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 800 800"
      className="kinetic-arena pointer-events-none absolute inset-0 m-auto h-full w-full opacity-[0.18]"
      style={{ maxWidth: "min(1000px, 80vw)" }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <style>{`
          .ring-a { animation: kineticSpin 36s linear infinite; transform-origin: 400px 400px; }
          .ring-b { animation: kineticSpin 24s linear infinite reverse; transform-origin: 400px 400px; }
          .pulse-core { animation: kineticPulse 3s ease-in-out infinite; transform-origin: 400px 400px; }
          @keyframes kineticSpin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes kineticPulse {
            0%, 100% { opacity: 0.7; transform: scale(1); }
            50% { opacity: 1; transform: scale(1.08); }
          }
          @media (prefers-reduced-motion: reduce) {
            .ring-a, .ring-b, .pulse-core { animation: none; }
          }
        `}</style>
      </defs>

      {/* Outer ring with tick marks every 30 degrees */}
      <g className="ring-a" stroke="var(--ink)" strokeWidth="1" fill="none">
        <circle cx="400" cy="400" r="360" />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          const x1 = 400 + Math.cos(a) * 355;
          const y1 = 400 + Math.sin(a) * 355;
          const x2 = 400 + Math.cos(a) * 370;
          const y2 = 400 + Math.sin(a) * 370;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
        })}
      </g>

      {/* Inner ring with tick marks every 45 degrees */}
      <g className="ring-b" stroke="var(--ink)" strokeWidth="1" fill="none">
        <circle cx="400" cy="400" r="250" />
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * 45 * Math.PI) / 180;
          const x = 400 + Math.cos(a) * 250;
          const y = 400 + Math.sin(a) * 250;
          return <rect key={i} x={x - 4} y={y - 4} width="8" height="8" fill="var(--ink)" stroke="none" />;
        })}
      </g>

      {/* Crosshair core */}
      <g stroke="var(--ink)" strokeWidth="1" fill="none">
        <line x1="400" y1="320" x2="400" y2="480" />
        <line x1="320" y1="400" x2="480" y2="400" />
      </g>

      {/* Pulsing center dot in accent */}
      <g className="pulse-core">
        <circle cx="400" cy="400" r="14" fill="var(--accent)" />
        <circle cx="400" cy="400" r="22" fill="none" stroke="var(--accent)" strokeWidth="1" />
      </g>

      {/* Static triangle frame echoing the TRACKING widget */}
      <g stroke="var(--ink)" strokeWidth="1" fill="none" opacity="0.6">
        <polygon points="400,140 660,560 140,560" />
      </g>
    </svg>
  );
}
