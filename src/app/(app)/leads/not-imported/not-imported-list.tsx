"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge, Button, Card, EmptyState, FormError } from "@/components/ui";
import { dismissImportAction, retryImportAction } from "./actions";

export interface NotImportedItem {
  id: string;
  sourceLabel: string;
  when: string;
  reason: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  message: string | null;
  visit: string | null;
  cancellation: boolean;
}

interface Done {
  id: string;
  text: string;
  href?: string;
}

export function NotImportedList({ items }: { items: NotImportedItem[] }) {
  const [done, setDone] = useState<Done | null>(null);
  // Rows dealt with here leave at once, without waiting for the page to refresh.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const visible = items.filter((i) => !gone.has(i.id));
  const finish = (d: Done) => {
    setDone(d);
    setGone((g) => new Set(g).add(d.id));
  };
  return (
    <div className="space-y-3">
      <div role="status">
        {done && (
          <p className="flex flex-wrap gap-x-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success">
            <span>{done.text}</span>
            {done.href && (
              <Link href={done.href} className="font-medium underline underline-offset-2 hover:no-underline">
                Open the lead
              </Link>
            )}
          </p>
        )}
      </div>
      {visible.length === 0 ? (
        <EmptyState title="Nothing waiting" description="Every website lead and booking has been imported." />
      ) : (
        <ul className="space-y-3">
          {visible.map((item) => (
            <Row key={item.id} item={item} onDone={finish} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ item, onDone }: { item: NotImportedItem; onDone: (d: Done) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const title = item.name ?? item.email ?? item.phone ?? "No name given";

  function retry() {
    start(async () => {
      const r = await retryImportAction(item.id);
      if (r.ok) {
        setError(null);
        onDone({ id: item.id, text: `${title}: ${r.message}`, href: r.opportunityId ? `/leads/${r.opportunityId}` : undefined });
      } else setError(r.error);
      router.refresh();
    });
  }

  function dismiss() {
    if (!window.confirm("Dismiss this one? It won't be imported, and it leaves this list.")) return;
    start(async () => {
      const r = await dismissImportAction(item.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onDone({ id: item.id, text: `${title}: dismissed.` });
      router.refresh();
    });
  }

  return (
    <li>
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-heading">{title}</span>
              <Badge>{item.sourceLabel}</Badge>
              {item.cancellation && <Badge tone="warning">Cancellation</Badge>}
              <span className="text-xs text-subtle">{item.when}</span>
            </p>
            {(item.email || item.phone) && <p className="break-words text-muted">{[item.email, item.phone].filter(Boolean).join(" · ")}</p>}
            {item.visit && <p className="text-muted">Visit: {item.visit}</p>}
            {item.message && <p className="whitespace-pre-wrap break-words text-text">{item.message}</p>}
            <p className="text-danger">
              <span className="font-medium">Why: </span>
              {item.reason}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={retry} disabled={pending}>
              {pending ? "Working…" : "Retry"}
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss} disabled={pending}>
              Dismiss
            </Button>
          </div>
        </div>
        {error && (
          <div className="mt-3">
            <FormError message={`Still couldn't import it: ${error}`} />
          </div>
        )}
      </Card>
    </li>
  );
}
