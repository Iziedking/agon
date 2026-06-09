/// Real brand marks for Arc, Circle, and USDC. Each one is a static image
/// served from /public/brands/, so the files match Circle and Arc brand
/// guidance exactly and we are not redrawing approximations in SVG.
///
/// File expectations:
///   /public/brands/arc.png      Arc — white arc/A on dark navy
///   /public/brands/circle.png   Circle — gradient broken ring on near-black
///   /public/brands/usdc.png     USDC — blue rounded square with white $
///
/// Each image is square. The component renders at 40x40 so anything from
/// 64x64 up to ~512x512 will look crisp; smaller will blur. PNG, SVG, or
/// WebP all work since this is a plain <img> tag.

import { BracketedCell } from "./BracketedCell";

function BrandImg({ src, alt }: { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={40}
      height={40}
      loading="lazy"
      decoding="async"
      className="h-10 w-10 flex-none rounded-md object-cover"
    />
  );
}

function Slot({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <BracketedCell pad="sm">
      <div className="flex items-center gap-4">
        {children}
        <span
          className="font-stencil uppercase text-ink"
          style={{ fontSize: 22, lineHeight: 1, letterSpacing: "0.02em" }}
        >
          {label}
        </span>
      </div>
    </BracketedCell>
  );
}

export function BuiltOnLogos() {
  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
      <Slot label="ARC"><BrandImg src="/brands/arc.png" alt="Arc Network" /></Slot>
      <Slot label="CIRCLE"><BrandImg src="/brands/circle.png" alt="Circle" /></Slot>
      <Slot label="USDC"><BrandImg src="/brands/usdc.png" alt="USDC" /></Slot>
    </div>
  );
}
