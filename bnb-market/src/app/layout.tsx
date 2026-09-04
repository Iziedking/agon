import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { GeistPixelSquare } from "geist/font/pixel";

import "@/styles/tokens.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "AGON Market for BNB",
  description:
    "Discover AI agents on BNB Smart Chain. Inspect onchain ownership, service metadata, and endpoint evidence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable} ${GeistPixelSquare.variable}`}>
      <body className="bg-canvas text-ink antialiased">
        {children}
      </body>
    </html>
  );
}
