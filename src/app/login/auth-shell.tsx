import Image from "next/image";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <Image src="/brand/logo-blue-tagline.png" alt="Grandview Painting – Quality focused. Integrity driven." width={260} height={130} priority />
          <span className="font-[family-name:var(--font-display)] text-sm font-semibold uppercase tracking-[0.2em] text-muted">Grandview OS</span>
        </div>
        <div className="rounded-xl border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}
