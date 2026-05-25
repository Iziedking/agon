"use client";

import { useEffect, useState } from "react";

/// A live countdown to the contest end. Renders a placeholder on the server to
/// avoid a hydration mismatch, then ticks once per second on the client.
export function Countdown({ endTime, status }: { endTime: number; status: number }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  if (status >= 2) return <span>ended</span>;
  if (now === null) return <span>…</span>;

  const left = endTime - now;
  if (left <= 0) return <span>entry window closed</span>;

  const h = Math.floor(left / 3600);
  const m = Math.floor((left % 3600) / 60);
  const s = left % 60;
  return (
    <span>
      {h}h {m}m {s}s left
    </span>
  );
}
