import type { Metadata } from "next";

import "@/styles/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AGON Market for BNB",
  description:
    "A chain-specific, judge-ready BNB marketplace shell for hiring ERC-8004 financial agents.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-canvas text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
