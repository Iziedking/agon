/// A horizontal hairline rule with a centered ring glyph and bracket notches
/// at both ends. Used between top-level sections on long pages to reinforce
/// the chaingpt "instrument panel" feel. Sits on canvas, no background of
/// its own. Decorative only.
export function SectionDivider() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-[1600px] px-6">
      <div className="relative flex items-center">
        {/* left bracket notch */}
        <span className="block h-2 w-2 border-b border-l border-[color:var(--ink)]" />
        {/* hairline running across */}
        <span className="block h-px flex-1 bg-[color:var(--hairline-strong)]" />
        {/* centered ring + tick marks */}
        <span className="relative mx-3 flex h-3 w-3 items-center justify-center">
          <span className="h-3 w-3 rounded-full border border-[color:var(--ink)]" />
          <span className="absolute h-1 w-1 rounded-full bg-[color:var(--ink)]" />
        </span>
        <span className="block h-px flex-1 bg-[color:var(--hairline-strong)]" />
        {/* right bracket notch */}
        <span className="block h-2 w-2 border-b border-r border-[color:var(--ink)]" />
      </div>
    </div>
  );
}
