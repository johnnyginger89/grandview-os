import { TriangleAlert } from "lucide-react";
import Link from "next/link";

/** On Leads: website leads or bookings waiting under "Couldn't import". */
export function NotImportedBanner({ count }: { count: number }) {
  if (count < 1) return null;
  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
      <TriangleAlert className="size-4 shrink-0" aria-hidden />
      <span>{count === 1 ? "1 web lead couldn't be imported" : `${count} web leads couldn't be imported`}</span>
      <span aria-hidden>·</span>
      <Link href="/leads/not-imported" className="font-medium underline underline-offset-2 hover:no-underline">
        Review
      </Link>
    </p>
  );
}
