"use client";
import { Calculator, ClipboardList, FileText, LoaderCircle, Search, Users, Workflow, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useRef, useState, type ComponentType } from "react";
import { Badge } from "@/components/ui";
import { highlightParts, MIN_QUERY_LENGTH } from "@/lib/search/query";
import { searchPageHref, type SearchHit, type SearchKind, type SearchResult } from "@/lib/search/types";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<SearchKind, ComponentType<{ className?: string }>> = {
  customer: Users,
  job: ClipboardList,
  estimate: Calculator,
  lead: Workflow,
  work_order: FileText,
};

export const SEARCH_PLACEHOLDER = "Search customers, addresses, quotes, jobs…";

type Fetched = { q: string; result: SearchResult | null; error: string | null };

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

function Highlighted({ text, words }: { text: string; words: string[] }) {
  return (
    <>
      {highlightParts(text, words).map((p, i) =>
        p.match ? <mark key={i} className="bg-transparent font-semibold text-text">{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>,
      )}
    </>
  );
}

/**
 * The one search box: customers, addresses, sold jobs, estimates, leads and work
 * orders. "bar" sits in the desktop top bar with a drop-down; "sheet" fills the
 * phone's search screen. "/" or Ctrl+K jumps to the bar from anywhere.
 */
export function GlobalSearch({ variant, onNavigate }: { variant: "bar" | "sheet"; onNavigate?: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [q, setQ] = useState("");
  const [focused, setFocused] = useState(variant === "sheet");
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [cursor, setCursor] = useState<{ q: string; index: number }>({ q: "", index: -1 });

  const text = q.trim();
  const ready = text.length >= MIN_QUERY_LENGTH;
  const current = ready && fetched?.q === text ? fetched : null;
  // While the next answer loads, keep showing the last one so the list doesn't flash.
  const shown = ready ? (current ?? fetched) : null;
  const loading = ready && !current;
  const words = text.split(" ").map((w) => w.replace(/^#/, "")).filter(Boolean);
  const hits: SearchHit[] = shown?.result?.groups.flatMap((g) => g.hits) ?? [];
  const optionCount = hits.length + (ready ? 1 : 0); // the last option is "See all results"
  const active = cursor.q === text ? Math.min(cursor.index, optionCount - 1) : -1;
  const open = variant === "sheet" || (focused && (ready || q.length === 0));
  const optionId = (i: number) => `${listId}-o${i}`;

  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(text)}`, { signal: ctrl.signal, headers: { Accept: "application/json" } })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as (SearchResult & { error?: string }) | null;
          if (res.ok && body?.groups) setFetched({ q: text, result: body, error: null });
          else setFetched({ q: text, result: null, error: body?.error ?? "Search isn't working right now. Please try again." });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) setFetched({ q: text, result: null, error: "Couldn't reach the server. Check your connection and try again." });
        });
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [text, ready]);

  // "/" or Ctrl/Cmd+K focuses the desktop search box. On a page with its own filter box
  // (marked data-page-search, e.g. Leads), "/" is left to that box; Ctrl/Cmd+K still comes here.
  useEffect(() => {
    if (variant !== "bar") return;
    const onKey = (e: KeyboardEvent) => {
      const slash = e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e.target);
      const cmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (!slash && !cmdK) return;
      const pageSearch = document.querySelector<HTMLElement>("[data-page-search]");
      if (slash && pageSearch && pageSearch.offsetParent !== null) return;
      const input = inputRef.current;
      if (!input || input.offsetParent === null) return; // hidden on phones
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant]);

  // Clicking anywhere else closes the drop-down.
  useEffect(() => {
    if (variant !== "bar" || !focused) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [variant, focused]);

  const done = () => {
    setQ("");
    setFocused(variant === "sheet");
    if (variant === "bar") inputRef.current?.blur();
    onNavigate?.();
  };
  const go = (href: string) => {
    router.push(href);
    done();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!optionCount) return;
      e.preventDefault();
      setFocused(true);
      const next = e.key === "ArrowDown" ? (active + 1 >= optionCount ? 0 : active + 1) : active <= 0 ? optionCount - 1 : active - 1;
      setCursor({ q: text, index: next });
      document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (!ready) return;
      e.preventDefault();
      go(active >= 0 && active < hits.length ? hits[active].href : searchPageHref(text));
    } else if (e.key === "Escape") {
      if (q) {
        e.preventDefault();
        setQ("");
      } else if (variant === "sheet") {
        onNavigate?.();
      } else {
        inputRef.current?.blur();
        setFocused(false);
      }
    } else if (e.key === "Tab" && variant === "bar") {
      setFocused(false);
    }
  };

  const count = hits.length;
  const status = !ready ? "" : loading && !shown ? "Searching…" : shown?.error ? shown.error : count === 0 ? `No matches for ${text}` : `${count} result${count === 1 ? "" : "s"}${shown?.result?.groups.some((g) => g.more) ? ", more on the full results page" : ""}`;

  const groups = shown?.result?.groups ?? [];
  const starts = groups.reduce<number[]>((acc, _g, gi) => [...acc, gi === 0 ? 0 : acc[gi - 1] + groups[gi - 1].hits.length], []);
  const panel = (
    <div
      id={listId}
      role="listbox"
      aria-label="Search results"
      className={cn(
        variant === "bar"
          ? "absolute inset-x-0 top-full z-50 mt-2 max-h-[min(70vh,34rem)] overflow-y-auto rounded-xl border border-border bg-surface py-2 shadow-pop"
          : "min-h-0 flex-1 overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]",
      )}
    >
      {!ready && (
        <div role="presentation" className="px-4 py-3 text-sm text-muted">
          <p>Type a name, street, phone number, or a number like <span className="font-medium text-text">#3033</span>, <span className="font-medium text-text">EST-5001</span> or <span className="font-medium text-text">WO-7001</span>.</p>
          {variant === "bar" && <p className="mt-1 text-xs text-subtle">Tip: press / anywhere to search.</p>}
        </div>
      )}
      {ready && shown?.error && <p role="presentation" className="px-4 py-3 text-sm text-danger">{shown.error}</p>}
      {ready && !shown && <p role="presentation" className="px-4 py-3 text-sm text-muted">Searching…</p>}
      {ready && shown?.result && count === 0 && (
        <p role="presentation" className="px-4 py-3 text-sm text-muted">
          No matches for “{text}”. Try part of a name or street, or a phone number.
        </p>
      )}
      {groups.map((g, gi) => {
        const labelId = `${listId}-${g.kind}`;
        return (
          <div key={g.kind} role="group" aria-labelledby={labelId} className="py-1">
            <p id={labelId} role="presentation" className="px-4 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</p>
            {g.hits.map((h, hi) => {
              const i = starts[gi] + hi;
              const Icon = KIND_ICON[h.kind];
              return (
                <Link
                  key={`${h.kind}-${h.id}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  tabIndex={-1}
                  href={h.href}
                  onClick={done}
                  onMouseMove={() => i !== active && setCursor({ q: text, index: i })}
                  className={cn("flex items-center gap-3 px-4", variant === "sheet" ? "min-h-14 py-2.5" : "py-2", i === active ? "bg-brand-soft" : "hover:bg-surface-2")}
                >
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", i === active ? "bg-surface text-brand" : "bg-surface-2 text-muted")}>
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text"><Highlighted text={h.title} words={words} /></span>
                    {h.detail && <span className="block truncate text-xs text-muted"><Highlighted text={h.detail} words={words} /></span>}
                  </span>
                  {h.status && <Badge tone={h.status.tone} className="shrink-0">{h.status.label}</Badge>}
                </Link>
              );
            })}
          </div>
        );
      })}
      {ready && (
        <Link
          id={optionId(hits.length)}
          role="option"
          aria-selected={active === hits.length}
          tabIndex={-1}
          href={searchPageHref(text)}
          onClick={done}
          onMouseMove={() => active !== hits.length && setCursor({ q: text, index: hits.length })}
          className={cn("mt-1 flex items-center gap-2 border-t border-border px-4 py-2.5 text-sm font-medium text-brand", active === hits.length ? "bg-brand-soft" : "hover:bg-surface-2")}
        >
          <Search className="size-4" aria-hidden /> See all results for “{text}”
        </Link>
      )}
    </div>
  );

  return (
    <div ref={boxRef} className={cn("relative", variant === "bar" ? "w-full max-w-xl" : "flex min-h-0 flex-1 flex-col")}>
      <div className={cn("relative", variant === "sheet" && "border-b border-border p-3")}>
        <Search className={cn("pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-subtle", variant === "sheet" ? "left-6" : "left-3")} aria-hidden />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          data-autofocus={variant === "sheet" ? "" : undefined}
          maxLength={100}
          value={q}
          placeholder={SEARCH_PLACEHOLDER}
          onChange={(e) => {
            setQ(e.target.value);
            setFocused(true);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full rounded-lg border text-text placeholder:text-subtle focus:outline-none [&::-webkit-search-cancel-button]:hidden",
            variant === "bar"
              ? "h-10 border-transparent bg-surface-2 pr-20 pl-9 text-sm focus:border-ring focus:bg-surface focus:ring-2 focus:ring-ring/20"
              : "h-12 border-border-strong bg-surface pr-12 pl-10 text-base focus:border-ring focus:ring-2 focus:ring-ring/20",
          )}
        />
        <span className={cn("absolute top-1/2 flex -translate-y-1/2 items-center gap-1", variant === "sheet" ? "right-5" : "right-2")}>
          {loading && <LoaderCircle className="size-4 animate-spin text-subtle" aria-hidden />}
          {q ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setQ("");
                inputRef.current?.focus();
              }}
              className="grid size-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : (
            variant === "bar" && !focused && <kbd className="rounded border border-border-strong bg-surface px-1.5 font-sans text-xs text-muted [body:has([data-page-search])_&]:hidden" aria-hidden>/</kbd>
          )}
        </span>
      </div>
      <p className="sr-only" aria-live="polite">{status}</p>
      {open && panel}
    </div>
  );
}
