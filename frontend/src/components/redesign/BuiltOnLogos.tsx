/// Recognizable brand marks for the three platforms ArcRun is built on,
/// rendered as flat monochrome SVGs so they sit inside the ink-on-canvas
/// system without colored brand fills. Each is paired with its wordmark in
/// stencil. ERC-8004 was removed from this strip per design feedback.

function ArcLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      {/* Open arc with a small dot at the apex — Arc Network's identity mark. */}
      <path
        d="M 4 24 A 12 12 0 0 1 28 24"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="3"
        strokeLinecap="square"
      />
      <circle cx="16" cy="10.5" r="2.5" fill="var(--ink)" />
    </svg>
  );
}

function CircleLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      {/* Outer ring */}
      <circle cx="16" cy="16" r="13" fill="none" stroke="var(--ink)" strokeWidth="2.5" />
      {/* Inverted C mark inside */}
      <path
        d="M 22 11 A 6 6 0 1 0 22 21"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="3"
        strokeLinecap="square"
      />
    </svg>
  );
}

function UsdcLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      {/* Coin outline */}
      <circle cx="16" cy="16" r="13.5" fill="none" stroke="var(--ink)" strokeWidth="2.5" />
      {/* Dollar sign: vertical bar plus the S curve */}
      <line x1="16" y1="6" x2="16" y2="26" stroke="var(--ink)" strokeWidth="2.5" strokeLinecap="square" />
      <path
        d="M 21 11.5 C 21 9.5 19 8.5 16 8.5 C 13 8.5 11 9.5 11 12 C 11 14.5 13 15 16 15.5 C 19 16 21 16.5 21 19 C 21 21.5 19 22.5 16 22.5 C 13 22.5 11 21.5 11 19.5"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoSlot({ children, name }: { children: React.ReactNode; name: string }) {
  return (
    <span className="inline-flex items-center gap-3">
      {children}
      <span className="font-stencil text-2xl uppercase tracking-[0.05em] text-ink" style={{ lineHeight: 1 }}>
        {name}
      </span>
    </span>
  );
}

export function BuiltOnLogos() {
  return (
    <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
      <LogoSlot name="ARC"><ArcLogo /></LogoSlot>
      <span aria-hidden className="text-ink-3">·</span>
      <LogoSlot name="CIRCLE"><CircleLogo /></LogoSlot>
      <span aria-hidden className="text-ink-3">·</span>
      <LogoSlot name="USDC"><UsdcLogo /></LogoSlot>
    </div>
  );
}
