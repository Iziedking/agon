import type { ReactNode } from "react";

/// Small blue pill chip that sits above each section headline (Pengu section label).
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-pill bg-pengu-blue/15 px-4 py-1.5 font-display text-sm uppercase tracking-wide text-pengu-blue">
      {children}
    </span>
  );
}

/// A chunky 3D bubble heading: Bagel Fat One in electric purple with a darker
/// purple extrude stacked beneath, the same drop-edge the buttons use. Gives
/// titles real sticker depth instead of sitting flat. Caller sets the size.
export function Bubble3D({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={`font-bubble uppercase leading-none text-pengu-blue ${className}`}
      style={{
        textShadow:
          "0 1px 0 #5b34d6, 0 2px 0 #5b34d6, 0 3px 0 #5b34d6, 0 4px 0 #5b34d6, 0 6px 6px rgba(27,17,64,0.22)",
      }}
    >
      {children}
    </h2>
  );
}

/// Pill CTA. Solid blue with a soft glow, or a ghost outline.
export function PillButton({
  href,
  children,
  variant = "solid",
}: {
  href: string;
  children: ReactNode;
  variant?: "solid" | "ghost";
}) {
  const base =
    "inline-flex items-center gap-2 rounded-pill px-6 py-3 font-display text-sm uppercase tracking-wide transition-transform duration-150 hover:-translate-y-0.5";
  const style =
    variant === "solid"
      ? "bg-pengu-blue text-white shadow-[0_8px_20px_rgba(124,77,255,0.35)]"
      : "border border-pengu-blue/50 text-pengu-blue hover:bg-pengu-blue/10";
  return (
    <a href={href} className={`${base} ${style}`}>
      {children}
    </a>
  );
}

/// Rounded 24px white card on the light sky background.
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-card border border-pengu-blue/15 bg-white p-8 shadow-[0_10px_30px_rgba(30,80,160,0.08)] ${className}`}
    >
      {children}
    </div>
  );
}
