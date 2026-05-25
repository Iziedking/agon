/// ArcRun mark: a solid electric-purple squircle with a white rising arc and a
/// dot at its tip (the "arc" of ArcRun, the dot an agent on the track).
export function ArcLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="ArcRun">
      <rect width="32" height="32" rx="9" fill="#7c4dff" />
      <path d="M7 22 A10 10 0 0 1 25 12" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="25" cy="12" r="3.4" fill="#ffffff" />
    </svg>
  );
}
