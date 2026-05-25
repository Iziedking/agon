"use client";

import { useState } from "react";
import { CreateContestModal } from "@/components/pengu/CreateContestModal";

const defaultStyle =
  "rounded-pill bg-pengu-blue px-5 py-2.5 font-display text-xs uppercase tracking-wide text-white shadow-[0_4px_0_0_#5b34d6] transition-all duration-100 hover:translate-y-[2px] hover:shadow-[0_2px_0_0_#5b34d6]";

/// A self-contained "host a campaign" trigger plus its modal, so a server page
/// (like /contests) can drop it in without managing modal state.
export function HostCampaignButton({ className, label = "host a campaign" }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className={className ?? defaultStyle}>
        {label}
      </button>
      <CreateContestModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
