"use client";

import type { CSSProperties, MouseEvent, ReactNode } from "react";

/// The product's CTA shape. A rectangular tag with a single notched
/// top-right corner. NOT a rounded pill. Two variants: primary (pink fill)
/// and ghost (transparent + 1px ink border). Hover lifts 1px and darkens
/// the accent by ~6%. No scale, no shadow bloom.
///
/// Always renders the right-pointing arrow `→` on the right side.

type Variant = "primary" | "ghost";
type Size = "md" | "sm";

const NOTCH = "polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%)";

interface Common {
  variant?: Variant;
  size?: Size;
  arrow?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  disabled?: boolean;
}

interface AsButton extends Common {
  href?: undefined;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  type?: "button" | "submit";
}
interface AsAnchor extends Common {
  href: string;
  target?: string;
  rel?: string;
}

export type TagButtonProps = AsButton | AsAnchor;

function classes(variant: Variant, size: Size, disabled: boolean): string {
  const base =
    "group inline-flex items-center gap-2 font-mono uppercase tracking-[0.12em] transition-transform duration-120 select-none";
  const pad = size === "sm" ? "px-3 py-1.5 text-[11px]" : "px-4 py-2.5 text-[13px]";
  const variantCls =
    variant === "primary"
      ? "bg-accent text-accent-ink hover:-translate-y-px hover:bg-accent-press"
      : "border border-ink text-ink hover:-translate-y-px hover:bg-canvas-3";
  const disabledCls = disabled ? "opacity-50 cursor-not-allowed pointer-events-none" : "";
  return `${base} ${pad} ${variantCls} ${disabledCls}`;
}

export function TagButton(props: TagButtonProps) {
  const { variant = "primary", size = "md", arrow = true, className = "", style, children, disabled } = props;
  const notchStyle: CSSProperties = { clipPath: NOTCH, ...style };
  const inner = (
    <>
      <span>{children}</span>
      {arrow ? <span aria-hidden>→</span> : null}
    </>
  );

  if ("href" in props && props.href !== undefined) {
    return (
      <a
        href={props.href}
        target={props.target}
        rel={props.rel}
        className={`${classes(variant, size, !!disabled)} ${className}`}
        style={notchStyle}
      >
        {inner}
      </a>
    );
  }
  return (
    <button
      type={(props as AsButton).type ?? "button"}
      onClick={(props as AsButton).onClick}
      disabled={disabled}
      className={`${classes(variant, size, !!disabled)} ${className}`}
      style={notchStyle}
    >
      {inner}
    </button>
  );
}
