"use client";
import Image from "next/image";
import { Phone } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SignPill } from "./state";

/**
 * Sticky bar that appears once the cover header scrolls away: section links with
 * scroll-spy (a chip row on phones), the phone number and a jump to signing.
 */
export function SectionNav({ items, name, phone, tel, signLabel }: { items: { id: string; label: string }[]; name: string; phone: string; tel: string; signLabel: string }) {
  const [shown, setShown] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const chips = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const header = document.getElementById("cover-header");
    if (!header) return;
    const io = new IntersectionObserver(([e]) => setShown(!e.isIntersecting));
    io.observe(header);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const sections = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => !!el);
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (!hit) return;
        setActive(hit.target.id);
        history.replaceState(null, "", `#${hit.target.id}`);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [items]);

  useEffect(() => {
    if (!active || !chips.current) return;
    const chip = chips.current.querySelector<HTMLElement>(`[data-id="${active}"]`);
    chip?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [active]);

  return (
    <nav
      aria-label="Proposal sections"
      className={cn(
        "fixed inset-x-0 top-0 z-40 border-b border-border bg-surface/95 backdrop-blur transition-transform print:hidden",
        shown ? "translate-y-0" : "-translate-y-full",
      )}
    >
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6 xl:h-16">
        <a href="#cover" className="flex shrink-0 items-center gap-2 font-[family-name:var(--font-display)] text-lg font-bold text-brand">
          <Image src="/brand/symbol-blue.png" alt="" width={28} height={28} className="size-7" />
          <span className="hidden sm:inline xl:hidden 2xl:inline">{name}</span>
        </a>
        <ul className="hidden flex-1 items-center justify-center gap-4 xl:flex">
          {items.map((i) => (
            <li key={i.id}>
              <a
                href={`#${i.id}`}
                aria-current={active === i.id ? "location" : undefined}
                className={cn("whitespace-nowrap border-b-2 py-1 text-sm font-medium transition-colors", active === i.id ? "border-brand text-brand" : "border-transparent text-muted hover:text-text")}
              >
                {i.label}
              </a>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-3 xl:ml-0">
          {phone && (
            <a href={tel} className="flex min-h-11 items-center gap-1.5 text-sm font-medium text-text hover:text-brand">
              <Phone className="size-4" /> <span className="hidden md:inline xl:hidden 2xl:inline">{phone}</span><span className="md:hidden xl:inline 2xl:hidden">Call</span>
            </a>
          )}
          <SignPill label={signLabel} />
        </div>
      </div>
      <div ref={chips} className="scrollbar-none flex snap-x gap-2 overflow-x-auto border-t border-border px-4 py-2 xl:hidden">
        {items.map((i) => (
          <a
            key={i.id}
            data-id={i.id}
            href={`#${i.id}`}
            aria-current={active === i.id ? "location" : undefined}
            className={cn(
              "shrink-0 snap-start rounded-full border px-3 py-1.5 text-sm font-medium",
              active === i.id ? "border-brand bg-brand text-white" : "border-border-strong text-muted",
            )}
          >
            {i.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
