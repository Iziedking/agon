"use client";

import { useState } from "react";
import { LoginModal } from "@/components/pengu/LoginModal";

/// A reusable button that opens the login popout, for use anywhere in the page
/// body (the navbar has its own LoginButton).
export function LoginCTA({ label = "log in", className }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={className}>
        {label}
      </button>
      <LoginModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
