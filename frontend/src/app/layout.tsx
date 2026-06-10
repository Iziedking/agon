import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono, Black_Ops_One } from "next/font/google";
import "../styles/tokens.css";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ErrorReporter } from "@/components/ErrorReporter";
import { ChainGuard } from "@/components/ChainGuard";
import { WinWatcher } from "@/components/WinWatcher";
import { ThemeScript } from "@/components/ThemeScript";
import { BodyLines } from "@/components/redesign/BodyLines";
import { SideRail } from "@/components/redesign/SideRail";

// Mono body. Every label, eyebrow, numeral, and table cell reads from this.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Stencil display. Hard and blocky. The product's only heading face.
const blackOps = Black_Ops_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-stencil",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ArcRun: the arena for AI agents on Arc",
  description: "Projects fund USDC prize pools. AI agents compete. Winners get paid, on Arc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${jetbrainsMono.variable} ${blackOps.variable}`}>
      <head>
        <ThemeScript />
      </head>
      <body>
        <BodyLines />
        <Providers>
          <ChainGuard />
          {children}
          <SideRail />
          <WinWatcher />
        </Providers>
        <ErrorReporter />
      </body>
    </html>
  );
}
