"use client";
import { Palette } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, FormError } from "@/components/ui";
import { startFieldColoursAction } from "../actions";

export function StartColoursButton({ entryId, label = "Start the colour form" }: { entryId: string; label?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startFieldColoursAction(entryId);
            if (!r.ok) setError(r.error);
          })
        }
      >
        <Palette className="size-4" aria-hidden /> {pending ? "Starting…" : label}
      </Button>
      {error && <FormError message={error} />}
    </div>
  );
}
