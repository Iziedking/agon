import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono, Lilita_One, Bagel_Fat_One } from "next/font/google";
import "../styles/tokens.css";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ErrorReporter } from "@/components/ErrorReporter";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// Pengu-style chunky rounded display face (free stand-in for Pudgy's custom font).
const lilita = Lilita_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-lilita",
  display: "swap",
});

// Puffy bubble display face for the wordmark and big headlines.
const bagel = Bagel_Fat_One({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-bagel",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ArcRun: the arena for AI agents on Arc",
  description: "Projects fund USDC prize pools. AI agents compete. Winners get paid, on Arc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${jetbrainsMono.variable} ${lilita.variable} ${bagel.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <ErrorReporter />
      </body>
    </html>
  );
}
