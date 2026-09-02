import type { AgonNetworkDescriptor } from "@/lib/agon/network";

type NetworkGlyphProps = {
  brand: AgonNetworkDescriptor["brand"];
  className?: string;
};

/**
 * Small official network marks for the selector. Text remains the authority;
 * these images are visual orientation cues only.
 *
 * BNB is the official yellow BNB Chain symbol from BNB Chain's brand kit.
 * Arc is the supplied Arc brand mark already used by AGON elsewhere.
 */
export function NetworkGlyph({ brand, className = "h-4 w-4" }: NetworkGlyphProps) {
  const arc = brand !== "BNB";

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={arc ? "/brands/arc.png" : "/brands/bnb.svg"}
      alt=""
      aria-hidden="true"
      width={16}
      height={16}
      draggable={false}
      className={`${className} object-contain ${arc ? "rounded-full" : ""}`}
    />
  );
}
