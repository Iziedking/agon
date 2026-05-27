/// Real brand logos for the BUILT ON strip on the landing page. Sourced
/// from the official marks: Arc Network (white A on navy), Circle (gradient
/// ring), USDC (white $ on blue). Each is paired with its wordmark in
/// stencil. ERC-8004 isn't in the strip anymore.

function LogoSlot({ src, alt, name }: { src: string; alt: string; name: string }) {
  return (
    <span className="inline-flex items-center gap-3">
      <img src={src} alt={alt} width={32} height={32} className="block" />
      <span className="font-stencil text-2xl uppercase tracking-[0.05em] text-ink" style={{ lineHeight: 1 }}>
        {name}
      </span>
    </span>
  );
}

export function BuiltOnLogos() {
  return (
    <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
      <LogoSlot src="/logos/arc.png" alt="Arc Network" name="ARC" />
      <span aria-hidden className="text-ink-3">·</span>
      <LogoSlot src="/logos/circle.png" alt="Circle" name="CIRCLE" />
      <span aria-hidden className="text-ink-3">·</span>
      <LogoSlot src="/logos/usdc.png" alt="USDC" name="USDC" />
    </div>
  );
}
