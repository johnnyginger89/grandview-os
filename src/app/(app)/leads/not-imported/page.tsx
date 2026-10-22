import { LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/authz/guard";
import { formatDateTime } from "@/lib/utils";
import { listNotImported } from "@/server/inbound-events";
import { NotImportedList } from "./not-imported-list";

export const metadata = { title: "Couldn't import" };

export default async function NotImportedPage() {
  await requirePermission("pipeline.write");
  const rows = await listNotImported();
  return (
    <>
      <PageHeader
        title="Couldn't import"
        description="Website leads and YouCanBook.me bookings that didn't make it into Leads. Retry once the problem is sorted, or dismiss ones you've handled yourself."
        actions={
          <LinkButton variant="secondary" href="/leads">
            Back to leads
          </LinkButton>
        }
      />
      <NotImportedList items={rows.map(({ receivedAt, ...r }) => ({ ...r, when: formatDateTime(receivedAt) }))} />
    </>
  );
}
