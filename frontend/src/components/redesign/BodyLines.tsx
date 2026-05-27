/// Five fixed vertical guide lines that frame the entire viewport, chaingpt
/// blueprint scaffold. Mounted once in the root layout so every page inherits
/// them. Hidden below md so mobile stays clean.
///
/// Stacking notes:
/// - `position: fixed` here adds a stacking context. We keep `z-index: 0` and
///   `pointer-events: none` so modals at `z-modal` (40) and any nav at z:20
///   sit on top and remain clickable. The earlier body::before pink anchor
///   broke the sign-in modal by using z:1 with fixed positioning — never
///   repeat that.
/// - Content containers do not need a z-index because they're flow elements
///   above this fixed layer.
export function BodyLines() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 hidden md:block"
    >
      {/* 0 / 25 / 50 / 75 / 100 percent columns. Faint ink at ~6 percent
          alpha so the scaffold is felt, not seen. Was at hairline (12%) and
          read as overbearing per user feedback. */}
      <span className="absolute bottom-0 left-0 top-0 w-px" style={{ background: "rgba(26,22,18,0.06)" }} />
      <span className="absolute bottom-0 left-1/4 top-0 w-px" style={{ background: "rgba(26,22,18,0.06)" }} />
      <span className="absolute bottom-0 left-1/2 top-0 w-px" style={{ background: "rgba(26,22,18,0.06)" }} />
      <span className="absolute bottom-0 left-3/4 top-0 w-px" style={{ background: "rgba(26,22,18,0.06)" }} />
      <span className="absolute bottom-0 right-0 top-0 w-px" style={{ background: "rgba(26,22,18,0.06)" }} />
    </div>
  );
}
