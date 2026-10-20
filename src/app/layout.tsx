import type { Metadata, Viewport } from "next";
import { Roboto, Roboto_Condensed } from "next/font/google";
import "./globals.css";

// Same families as grandviewpainting.ca, self-hosted at build time.
const roboto = Roboto({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-roboto", display: "swap" });
const robotoCondensed = Roboto_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-roboto-condensed", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Grandview OS", template: "%s · Grandview OS" },
  description: "Business management for Grandview Painting Ltd.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#100599",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA" className={`${roboto.variable} ${robotoCondensed.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
