/// Four small 6px crimson squares at the corners of a section, pinning it
/// to the page grid. Drop this inside any `position: relative` section
/// wrapper and the markers will absolutely-position at its corners.
///
/// Usage:
///   <section className="relative …">
///     <CornerMarkers />
///     …content…
///   </section>
export function CornerMarkers({ inset = 0 }: { inset?: number }) {
  const dot =
    "absolute h-1.5 w-1.5 bg-accent pointer-events-none";
  const i = `${inset}px`;
  return (
    <>
      <span aria-hidden className={dot} style={{ top: i, left: i, transform: "translate(-50%, -50%)" }} />
      <span aria-hidden className={dot} style={{ top: i, right: i, transform: "translate(50%, -50%)" }} />
      <span aria-hidden className={dot} style={{ bottom: i, left: i, transform: "translate(-50%, 50%)" }} />
      <span aria-hidden className={dot} style={{ bottom: i, right: i, transform: "translate(50%, 50%)" }} />
    </>
  );
}
