"use client";

import type { ReactNode } from "react";

/// Prev/next pagination control with a page indicator. Two modes:
/// - Anchor mode: pass `basePath`, the control renders `<a href="basePath?page=N">`.
/// - Callback mode: pass `onPage`, the control renders `<button onClick={() => onPage(N)}>`
///   so the grid swaps in place without a URL change.
/// Renders nothing when there's only one page.
type Props = { page: number; totalPages: number } & (
  | { basePath: string; onPage?: never }
  | { onPage: (page: number) => void; basePath?: never }
);

export function Pagination({ page, totalPages, basePath, onPage }: Props) {
  if (totalPages <= 1) return null;
  const prev = page > 1 ? page - 1 : null;
  const next = page < totalPages ? page + 1 : null;
  return (
    <div className="mt-10 flex items-center justify-center gap-3">
      <PageBtn target={prev} basePath={basePath} onPage={onPage}>← prev</PageBtn>
      <span className="font-mono text-xs text-pengu-dark/60">
        page {page} of {totalPages}
      </span>
      <PageBtn target={next} basePath={basePath} onPage={onPage}>next →</PageBtn>
    </div>
  );
}

function PageBtn({
  target,
  basePath,
  onPage,
  children,
}: {
  target: number | null;
  basePath?: string;
  onPage?: (page: number) => void;
  children: ReactNode;
}) {
  const base = "rounded-pill border px-4 py-2 font-display text-xs uppercase tracking-wide";
  if (target == null) {
    return <span className={`${base} border-pengu-blue/10 text-pengu-dark/30`}>{children}</span>;
  }
  const enabled = `${base} border-pengu-blue/30 bg-white text-pengu-blue transition-colors hover:border-pengu-blue`;
  if (basePath) {
    return (
      <a href={`${basePath}?page=${target}`} className={enabled}>
        {children}
      </a>
    );
  }
  if (onPage) {
    return (
      <button onClick={() => onPage(target)} className={enabled}>
        {children}
      </button>
    );
  }
  return null;
}
