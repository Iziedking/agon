"use client";

import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent } from "react";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { FEEDBACK_OPEN_EVENT, submitFeedback } from "@/lib/feedback";

/// Floating feedback pin. A small pink tag fixed bottom-right that opens a
/// short form to report a bug or suggest an improvement. The report relays to
/// the team's Telegram. Mounted globally; the floating pin is hidden on the
/// marketing landing page, but the modal still opens from the footer link
/// (which dispatches FEEDBACK_OPEN_EVENT), so feedback is reachable everywhere.

type Kind = "bug" | "idea";

export function FeedbackPin() {
  const pathname = usePathname() ?? "/";
  const { address } = useAccount();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [imgErr, setImgErr] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4MB

  function readImage(file: File | null | undefined) {
    setImgErr(null);
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImgErr("that's not an image");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImgErr("image too large, keep it under 4MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImage(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  }

  function onPaste(e: ReactClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (item) readImage(item.getAsFile());
  }

  const showPin = pathname !== "/"; // never the floating pin on the landing page

  // Footer link (and anywhere else) can open the widget via a window event.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(FEEDBACK_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(FEEDBACK_OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function send() {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    setSubmitErr(null);
    const ok = await submitFeedback({
      type: kind,
      message: text,
      path: pathname,
      address,
      image: image ?? undefined,
    });
    setSending(false);
    if (ok) {
      setSent(true);
      setMessage("");
      setImage(null);
      setImgErr(null);
    } else {
      setSubmitErr("could not send. check your connection and try again.");
    }
  }

  function sendAnother() {
    setSent(false);
    setSubmitErr(null);
  }

  return (
    <div ref={ref}>
      {showPin ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Send feedback"
          className="fixed bottom-4 right-4 z-modal flex min-h-11 items-center gap-2 border border-[color:var(--accent-ink)] bg-accent px-3 py-2.5 font-mono text-[11px] uppercase tracking-[0.14em] text-accent-ink shadow-[0_8px_24px_rgba(26,22,18,0.18)] transition-transform duration-120 hover:-translate-y-px sm:bottom-6 sm:right-6"
          style={{ clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)" }}
        >
          <BubbleGlyph />
          <span className="hidden sm:inline">FEEDBACK</span>
        </button>
      ) : null}

      {open ? (
        <div className="fixed inset-x-3 bottom-3 z-modal border border-ink bg-canvas shadow-[0_12px_40px_rgba(26,22,18,0.22)] sm:inset-x-auto sm:bottom-20 sm:right-6 sm:w-[360px]">
          <div className="flex items-center justify-between border-b border-[color:var(--hairline)] px-4 py-3">
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-ink">
              <span aria-hidden className="text-accent">■</span> FEEDBACK
            </span>
            <button
              onClick={() => setOpen(false)}
              aria-label="close"
              className="inline-flex h-11 w-11 items-center justify-center font-mono text-[14px] leading-none text-ink-3 hover:text-ink"
            >
              ×
            </button>
          </div>

          {sent ? (
            <div className="px-4 py-8 text-center">
              <div className="text-accent" aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>■</div>
              <div className="mt-3 font-mono text-[13px] text-ink">thanks, sent to the team.</div>
              <p className="mt-1 font-mono text-[11px] text-ink-3">we read every report.</p>
              <div className="mt-5 flex justify-center gap-2">
                <button
                  onClick={sendAnother}
                  className="border border-ink-3 bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
                >
                  SEND ANOTHER
                </button>
                <button
                  onClick={() => { setSent(false); setOpen(false); }}
                  className="border border-[color:var(--accent-ink)] bg-accent px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink hover:-translate-y-px"
                >
                  DONE
                </button>
              </div>
            </div>
          ) : (
            <div className="px-4 py-4">
              <div className="flex gap-2">
                {(["bug", "idea"] as const).map((k) => (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className={
                      kind === k
                        ? "min-h-11 border border-accent bg-accent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-accent-ink"
                        : "min-h-11 border border-ink-3 bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
                    }
                  >
                    {k === "bug" ? "BUG" : "IDEA"}
                  </button>
                ))}
              </div>

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onPaste={onPaste}
                maxLength={2000}
                rows={4}
                placeholder={
                  kind === "bug"
                    ? "what broke, and what were you doing? (paste a screenshot here too)"
                    : "what would make this better?"
                }
                className="mt-3 w-full resize-none border border-[color:var(--hairline-strong)] bg-canvas px-3 py-2 font-mono text-[13px] text-ink outline-none placeholder:text-ink-3 focus:border-ink"
              />

              {/* Screenshot attach. Click to pick a file, or paste into the box above. */}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => readImage(e.target.files?.[0])}
              />
              {image ? (
                <div className="mt-3 flex items-center gap-3 border border-[color:var(--hairline)] p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image} alt="screenshot preview" className="h-12 w-12 object-cover" />
                  <span className="flex-1 font-mono text-[11px] text-ink-2">screenshot attached</span>
                  <button
                    onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = ""; }}
                    className="inline-flex min-h-11 items-center font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 hover:text-accent"
                  >
                    REMOVE
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileRef.current?.click()}
                  className="mt-3 flex min-h-11 items-center gap-2 border border-ink-3 bg-canvas px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-2 hover:border-ink hover:text-ink"
                >
                  + ATTACH SCREENSHOT
                </button>
              )}
              {imgErr ? <p className="mt-1.5 font-mono text-[10px] text-[color:var(--err)]">{imgErr}</p> : null}

              <div className="mt-3 flex items-center justify-between">
                <span className="font-mono text-[10px] text-ink-3">{message.length}/2000</span>
                <button
                  onClick={() => void send()}
                  disabled={!message.trim() || sending}
                  className="min-h-11 border border-[color:var(--accent-ink)] bg-accent px-4 py-2 font-mono text-[12px] uppercase tracking-[0.12em] text-accent-ink transition-transform duration-120 hover:-translate-y-px disabled:opacity-50"
                  style={{ clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%)" }}
                >
                  {sending ? "SENDING…" : "SEND →"}
                </button>
              </div>
              {submitErr ? <p className="mt-2 font-mono text-[10px] text-[color:var(--err)]">{submitErr}</p> : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BubbleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2 3.2h12v8H6.5L3.5 14v-2.8H2V3.2Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
