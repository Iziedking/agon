/// Small deterministic RNG (mulberry32) so contests and grading are
/// reproducible from a seed. Not for cryptographic use.
export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = (r: () => number, n: number): number => Math.floor(r() * n);
export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
