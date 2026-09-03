"use client";

import Link from "next/link";
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
  // Ghost variant inherits its color from the parent so it reads correctly
  // on every tone the BracketedCell renders. On an ink-filled card the
  // border and text become cream automatically; on a canvas section they
  // stay ink. The hover overlay uses opacity so it still works on both.
  const variantCls =
    variant === "primary"
      ? "bg-accent text-accent-ink hover:-translate-y-px hover:bg-accent-press"
      : "border border-current text-current hover:-translate-y-px hover:opacity-80";
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
    // Internal routes go through next/link so navigation is client-side and
    // the wallet connection survives in memory. A plain <a> would hard-reload,
    // remounting the whole provider tree and forcing a wallet reconnect on
    // every click. External / target="_blank" links stay a plain anchor.
    const isInternal = props.href.startsWith("/") && !props.target;
    const anchorCls = `${classes(variant, size, !!disabled)} ${className}`;
    if (isInternal) {
      return (
        <Link href={props.href} className={anchorCls} style={notchStyle}>
          {inner}
        </Link>
      );
    }
    return (
      <a
        href={props.href}
        target={props.target}
        rel={props.rel}
        className={anchorCls}
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
