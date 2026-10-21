"use client";
import { useEffect, useRef } from "react";

/** Opens every contract part on wide screens and before printing; "Expand all" on phones. */
export function ContractExpander() {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const root = ref.current?.closest("[data-contract]");
    if (!root) return;
    const openAll = () => root.querySelectorAll("details").forEach((d) => (d.open = true));
    const mq = window.matchMedia("(min-width: 768px)");
    if (mq.matches) openAll();
    const onChange = (e: MediaQueryListEvent) => e.matches && openAll();
    mq.addEventListener("change", onChange);
    window.addEventListener("beforeprint", openAll);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("beforeprint", openAll);
    };
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => e.currentTarget.closest("[data-contract]")?.querySelectorAll("details").forEach((d) => (d.open = true))}
      className="mb-2 min-h-11 text-sm font-medium text-brand underline md:hidden print:hidden"
    >
      Expand all
    </button>
  );
}
