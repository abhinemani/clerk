import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Public_Sans, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { branding } from "@/config/branding";
import { HydrationSignal } from "./_components/HydrationSignal";

// Self-hosted at build time (next/font) — no runtime font requests.
// Public Sans is the U.S. government's own typeface (USWDS); Source Serif
// carries the official-document register for display type.
const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${branding.productName} — ${branding.tagline}`,
  description: branding.tagline,
};

/**
 * Root layout is deliberately bare: the marketing site (/), agency portals
 * (/[agency]) and the platform console (/admin) each bring their own chrome.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${publicSans.variable} ${sourceSerif.variable}`}>
      <body>
        <HydrationSignal />
        {children}
      </body>
    </html>
  );
}
