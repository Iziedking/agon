"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ModalClose, RangeSlider } from "@/components/redesign";

/// Square crop step for a custom agent skin. Dependency-free: pan by dragging,
/// zoom with the slider, and the visible square is rendered to a 256x256 PNG
/// (falling back to JPEG when a photo would blow past the server's size cap).
/// Mobile-first: the viewport is sized to fit a phone and drag uses pointer
/// events so it works with touch.

const VIEWPORT = 288; // px; the square crop frame (also the math reference)
const OUT = 256; // output edge in px

export function SkinCropModal({
  file,
  onCancel,
  onCrop,
}: {
  file: File;
  onCancel: () => void;
  onCrop: (dataUrl: string) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [off, setOff] = useState({ x: 0, y: 0 });
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Cover the square at zoom 1, then scale up by the zoom factor.
  const base = img ? VIEWPORT / Math.min(img.width, img.height) : 1;
  const eff = base * zoom;
  const dispW = img ? img.width * eff : VIEWPORT;
  const dispH = img ? img.height * eff : VIEWPORT;

  // Keep the image covering the frame: offsets clamped so no gap shows.
  const clamp = useCallback(
    (x: number, y: number) => ({
      x: Math.min(0, Math.max(VIEWPORT - dispW, x)),
      y: Math.min(0, Math.max(VIEWPORT - dispH, y)),
    }),
    [dispW, dispH],
  );

  // Center the image when it loads, and re-clamp when the zoom changes.
  useEffect(() => {
    if (!img) return;
    setOff(clamp((VIEWPORT - dispW) / 2, (VIEWPORT - dispH) / 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);
  useEffect(() => {
    setOff((o) => clamp(o.x, o.y));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { sx: e.clientX, sy: e.clientY, ox: off.x, oy: off.y };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    setOff(clamp(drag.current.ox + (e.clientX - drag.current.sx), drag.current.oy + (e.clientY - drag.current.sy)));
  }
  function onPointerUp() {
    drag.current = null;
  }

  function useCrop() {
    if (!img) return;
    const srcSize = VIEWPORT / eff;
    const srcX = -off.x / eff;
    const srcY = -off.y / eff;
    const c = document.createElement("canvas");
    c.width = OUT;
    c.height = OUT;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, OUT, OUT);
    let out = c.toDataURL("image/png");
    // PNG of a photo can exceed the 256KB server cap; fall back to JPEG.
    if (out.length > 320_000) out = c.toDataURL("image/jpeg", 0.85);
    onCrop(out);
  }

  return (
    <div
      className="fixed inset-0 z-modal overflow-y-auto"
      style={{ backgroundColor: "rgba(27,17,18,0.55)" }}
      onClick={onCancel}
    >
      <div className="flex min-h-full items-center justify-center px-4 py-10">
        <div
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-[360px] border border-ink bg-canvas p-6"
        >
          <ModalClose onClick={onCancel} />
          <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
            <span aria-hidden className="text-accent">■</span> CROP YOUR SKIN
          </div>
          <p className="mt-1.5 font-mono text-[11px] leading-[1.5] text-ink-2">
            drag to reposition, zoom to frame it. saved as a square.
          </p>

          <div
            className="relative mx-auto mt-4 overflow-hidden border border-[color:var(--hairline-strong)] bg-canvas-3 touch-none select-none"
            style={{ width: VIEWPORT, height: VIEWPORT, maxWidth: "100%" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {img ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.src}
                alt=""
                draggable={false}
                style={{ position: "absolute", left: off.x, top: off.y, width: dispW, height: dispH, cursor: "grab" }}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center font-mono text-[11px] text-ink-3">
                loading…
              </div>
            )}
          </div>

          <div className="mt-4">
            <RangeSlider
              label="ZOOM"
              ariaLabel="Zoom"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={setZoom}
              format={(v) => `${v.toFixed(2)}x`}
            />
          </div>

          <div className="mt-5 flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 border border-ink bg-canvas px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.12em] text-ink hover:bg-canvas-3"
            >
              CANCEL
            </button>
            <button
              onClick={useCrop}
              disabled={!img}
              className="flex-1 bg-accent px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink hover:bg-accent-press disabled:opacity-60"
            >
              USE PHOTO →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
