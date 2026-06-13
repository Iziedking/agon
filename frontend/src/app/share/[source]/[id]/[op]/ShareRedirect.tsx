"use client";

import { useEffect } from "react";

/// Sends a human who clicked a share link on to the live event. Crawlers
/// (X / Discord / Telegram) don't run JS, so they read the page's metadata and
/// render the win card; people get bounced to the arena. A short delay lets the
/// page paint first.
export function ShareRedirect({ to }: { to: string }) {
  useEffect(() => {
    const t = setTimeout(() => window.location.replace(to), 400);
    return () => clearTimeout(t);
  }, [to]);
  return null;
}
