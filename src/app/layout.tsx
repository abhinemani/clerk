import type { Metadata } from "next";
import type { ReactNode } from "react";
import { branding } from "@/config/branding";

export const metadata: Metadata = {
  title: branding.productName,
  description: branding.tagline,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
