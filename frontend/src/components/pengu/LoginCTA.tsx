"use client";

import { useState } from "react";
import { LoginModal } from "@/components/pengu/LoginModal";
import { TagButton } from "@/components/redesign";

/// A reusable button that opens the login popout, for use anywhere in the page
/// body (the navbar has its own LoginButton). Without `className`, renders the
/// brand TagButton. With `className`, renders a plain button so callers can
/// keep their full-width/in-panel styling (Enter / Join panels).
export function LoginCTA({ label = "LOG IN", className }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {className ? (
        <button onClick={() => setOpen(true)} className={className}>
          {label}
        </button>
      ) : (
        <TagButton variant="primary" size="md" onClick={() => setOpen(true)}>
          {label}
        </TagButton>
      )}
      <LoginModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
