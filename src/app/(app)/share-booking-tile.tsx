"use client";
import { Share2 } from "lucide-react";
import { useState } from "react";

/** Send the YouCanBook.me link from the phone's own share sheet (text, email, Messenger…). */
export function ShareBookingTile({ url, companyName }: { url: string; companyName: string }) {
  const [copied, setCopied] = useState(false);
  async function share() {
    const text = `Book your free painting estimate with ${companyName}:`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Book your estimate", text, url });
      } catch {
        // The person closed the share sheet.
      }
      return;
    }
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }
  return (
    <button type="button" onClick={share} className="flex aspect-[5/3] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-surface text-center shadow-sm active:bg-surface-2">
      <Share2 className="size-8 text-brand" />
      <span className="text-base font-medium" aria-live="polite">{copied ? "Link copied" : "Share booking link"}</span>
    </button>
  );
}
