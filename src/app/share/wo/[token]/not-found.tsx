import { Phone } from "lucide-react";
import Image from "next/image";
import { officeContact } from "@/server/work-orders";

/** Shown for unknown, expired and turned-off links alike, so a link's state can't be probed. */
export default async function WorkOrderLinkNotFound() {
  const office = await officeContact().catch(() => ({ name: "", phone: null }));
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center px-6 py-12 text-center">
      <Image src="/brand/logo-blue.png" alt={office.name || "Grandview Painting"} width={160} height={80} className="h-auto w-36" loading="eager" />
      <h1 className="mt-8 font-[family-name:var(--font-display)] text-2xl font-bold text-brand">This link isn&apos;t working</h1>
      <p className="mt-3 text-text">This work order link has expired or been turned off. Ask the office for a new one.</p>
      {office.phone && (
        <a href={`tel:${office.phone.replace(/[^\d+]/g, "")}`} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md bg-brand px-5 font-medium text-brand-contrast hover:bg-brand-hover">
          <Phone className="size-4" aria-hidden /> Call the office: {office.phone}
        </a>
      )}
    </main>
  );
}
