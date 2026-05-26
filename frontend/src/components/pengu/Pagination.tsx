import type { ReactNode } from "react";

/// A prev/next pagination control with a page indicator. Pure server component;
/// emits search-param links so the contests and challenges grids never scroll
/// forever. Renders nothing when there's only one page.
export function Pagination({
  page,
  totalPages,
  basePath,
}: {
  page: number;
  totalPages: number;
  basePath: string;
}) {
  if (totalPages <= 1) return null;
  const prev = page > 1 ? `${basePath}?page=${page - 1}` : null;
  const next = page < totalPages ? `${basePath}?page=${page + 1}` : null;
  return (
    <div className="mt-10 flex items-center justify-center gap-3">
      <PageLink href={prev}>← prev</PageLink>
      <span className="font-mono text-xs text-pengu-dark/60">
        page {page} of {totalPages}
      </span>
      <PageLink href={next}>next →</PageLink>
    </div>
  );
}

function PageLink({ href, children }: { href: string | null; children: ReactNode }) {
  const base = "rounded-pill border px-4 py-2 font-display text-xs uppercase tracking-wide";
  if (!href) {
    return <span className={`${base} border-pengu-blue/10 text-pengu-dark/30`}>{children}</span>;
  }
  return (
    <a href={href} className={`${base} border-pengu-blue/30 bg-white text-pengu-blue transition-colors hover:border-pengu-blue`}>
      {children}
    </a>
  );
}
