import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Grandview OS", template: "%s · Grandview OS" },
  description: "Business management for Grandview Painting Ltd.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#1f5c45",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-CA" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
