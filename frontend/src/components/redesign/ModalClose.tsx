"use client";

/// Shared modal close affordance. No emoji as iconography: uses the
/// mathematical "×" operator in mono, not the heavy dingbat. Hover
/// thickens to ink + flips to accent.
///
/// 32x32 hit target absolute-positioned top-right of any modal panel.
/// Caller passes onClick; we own everything else.

export function ModalClose({
  onClick,
  ariaLabel = "close",
}: {
  onClick: () => void;
  ariaLabel?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      type="button"
      className="group absolute right-3 top-3 flex h-11 w-11 items-center justify-center border border-transparent font-mono text-[16px] leading-none text-ink-3 transition-[color,border-color] duration-120 hover:border-[color:var(--hairline-strong)] hover:text-accent"
    >
      <span aria-hidden>×</span>
    </button>
  );
}
