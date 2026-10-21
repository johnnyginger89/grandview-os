import type { Metadata } from "next";

// The token is in the URL, so no page here may leak it in a Referer header or to a search index.
export const metadata: Metadata = {
  title: { absolute: "Work order" },
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function SharedWorkOrderLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-bg sm:py-8 print:bg-white print:py-0">{children}</div>;
}
