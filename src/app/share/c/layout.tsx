import type { Metadata } from "next";

// The token is in the URL, so no page here may leak it in a Referer header or to a search index.
export const metadata: Metadata = {
  title: { absolute: "Your colour selections" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function SharedColourFormLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-bg px-4 py-6 sm:py-10 print:bg-white print:p-0">{children}</div>;
}
