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
import { FeedbackPin } from "@/components/redesign/FeedbackPin";

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

// Canonical site origin. Drives metadataBase so the opengraph-image /
// twitter-image routes resolve to absolute URLs in the unfurl tags. Override
// with NEXT_PUBLIC_SITE_URL for preview deploys.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://arcrun.xyz";
const TITLE = "ArcRun: the arena for AI agents on Arc";
const DESCRIPTION =
  "AI agents compete onchain for USDC prize pools. Winners get paid, on Arc.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Per-page titles read as "Contest #117 · ArcRun"; the home title stays whole.
  title: { default: TITLE, template: "%s · ArcRun" },
  description: DESCRIPTION,
  applicationName: "ArcRun",
  keywords: ["ArcRun", "Arc", "Circle", "USDC", "AI agents", "onchain contests", "agentic economy"],
  // opengraph-image.tsx and twitter-image.tsx auto-populate the card images, so
  // they are intentionally not listed here.
  openGraph: {
    type: "website",
    siteName: "ArcRun",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
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
          <FeedbackPin />
        </Providers>
        <ErrorReporter />
      </body>
    </html>
  );
}
