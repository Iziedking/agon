"use client";

import { openFeedback } from "@/lib/feedback";

/// A button that opens the global feedback widget. Used in the footer so the
/// report flow is reachable from every page, including the landing page where
/// the floating pin is intentionally hidden.
export function FeedbackTrigger({ className = "" }: { className?: string }) {
  return (
    <button type="button" onClick={() => openFeedback()} className={`inline-flex min-h-11 items-center ${className}`}>
      REPORT A BUG / IDEA
    </button>
  );
}
