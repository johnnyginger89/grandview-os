import Image from "next/image";
import type { ReactNode } from "react";
import type { Block } from "@/lib/proposal-template/prose";
import { cn } from "@/lib/utils";
import type { PresentationImage, PresentationLink } from "@/server/proposal-presentation";

export function Blocks({ blocks, className, listClassName }: { blocks: Block[]; className?: string; listClassName?: string }) {
  if (!blocks.length) return null;
  return (
    <div className={cn("space-y-3", className)}>
      {blocks.map((b, i) =>
        b.type === "p" ? (
          <p key={i} className="whitespace-pre-line">{b.text}</p>
        ) : (
          <ul key={i} className={cn("list-disc space-y-1.5 pl-5 marker:text-accent", listClassName)}>
            {b.items.map((x, j) => <li key={j}>{x}</li>)}
          </ul>
        ),
      )}
    </div>
  );
}

/** Photo at a fixed aspect ratio, cropped around the owner's focal point. */
export function Photo({ image, className, sizes, priority, testId }: { image: PresentationImage; className?: string; sizes: string; priority?: boolean; testId?: string }) {
  return (
    <div data-testid={testId} className={cn("relative overflow-hidden rounded-xl bg-surface-2", className)}>
      <Image
        src={image.url}
        alt={image.alt}
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover"
        style={{ objectPosition: `${image.focalX}% ${image.focalY}%` }}
      />
    </div>
  );
}

export function SectionBanner({
  id,
  title,
  subtitle,
  tone = "plain",
  logo = true,
  className,
}: {
  id: string;
  title: string;
  subtitle?: string;
  tone?: "plain" | "accent";
  logo?: boolean;
  className?: string;
}) {
  const accent = tone === "accent";
  return (
    <header className={cn("flex items-center justify-between gap-6 rounded-xl px-6 py-6 lg:px-10 lg:py-8", accent ? "bg-accent text-white" : "bg-bg", className)}>
      <div>
        <h2 id={id} className={cn("font-[family-name:var(--font-display)] text-[30px] font-bold leading-tight lg:text-5xl", accent ? "text-white" : "text-brand")}>{title}</h2>
        {subtitle && <p className={cn("mt-2 text-[13px] font-bold uppercase tracking-[0.08em] lg:text-sm", accent ? "text-white/90" : "text-text")}>{subtitle}</p>}
      </div>
      {logo && !accent && <Image src="/brand/logo-blue.png" alt="" width={160} height={80} className="hidden h-auto w-36 shrink-0 md:block lg:w-40" />}
    </header>
  );
}

export function Section({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-28 py-12 xl:scroll-mt-20 lg:py-[72px]", className)}>
      {children}
    </section>
  );
}

export function ExternalHint({ link }: { link: PresentationLink }) {
  return link.external ? <span className="sr-only"> (opens in a new tab)</span> : null;
}

export function CtaBar({ link }: { link: PresentationLink }) {
  return (
    <a
      href={link.href}
      {...(link.external ? { target: "_blank", rel: "noopener" } : {})}
      className="mt-8 flex h-16 items-center justify-center rounded-xl bg-accent px-6 text-center text-lg font-bold uppercase tracking-wide text-white hover:brightness-95 lg:h-20 lg:text-xl print:hidden"
    >
      {link.label}
      <ExternalHint link={link} />
    </a>
  );
}

export function MediaRow({
  title,
  body,
  image,
  reverse,
  surface,
  portrait,
  children,
}: {
  title: string;
  body: Block[];
  image: PresentationImage;
  reverse?: boolean;
  surface?: boolean;
  portrait?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn("grid items-center gap-8 md:grid-cols-2 lg:gap-12", surface && "rounded-2xl bg-surface-2 p-6 lg:p-12")}>
      <Photo
        image={image}
        sizes="(min-width: 768px) 50vw, 100vw"
        className={cn(portrait ? "aspect-[4/5] md:aspect-square" : "aspect-[3/2]", reverse && "md:order-2", "print:hidden")}
      />
      <div>
        <h3 className="text-[26px] font-medium leading-tight lg:text-[32px]">{title}</h3>
        <Blocks blocks={body} className="mt-4 text-base leading-relaxed lg:text-[17px]" />
        {children}
      </div>
    </div>
  );
}

export function NavyBand({ blocks }: { blocks: Block[] }) {
  if (!blocks.length) return null;
  return (
    <div className="rounded-xl bg-brand px-6 py-8 text-center text-[17px] font-medium leading-relaxed text-white lg:text-lg">
      <Blocks blocks={blocks} className="mx-auto max-w-[60ch]" />
    </div>
  );
}

export function Stars({ rating }: { rating: number }) {
  return (
    <span role="img" aria-label={`${rating} out of 5 stars`} className="flex gap-0.5 text-brand">
      {Array.from({ length: 5 }, (_, i) => (
        <svg key={i} viewBox="0 0 20 20" className={cn("size-[18px]", i < rating ? "fill-current" : "fill-border-strong")} aria-hidden="true">
          <path d="M10 1.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L10 14.9l-5.2 2.7 1-5.8L1.5 7.7l5.9-.9z" />
        </svg>
      ))}
    </span>
  );
}

const ICON_PATHS = {
  facebook: "M13.5 21v-7.5h2.5l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21z",
  instagram:
    "M12 7.4a4.6 4.6 0 100 9.2 4.6 4.6 0 000-9.2zm0 7.6a3 3 0 110-6 3 3 0 010 6zm5.9-7.8a1.1 1.1 0 11-2.2 0 1.1 1.1 0 012.2 0zM21 8.3c-.1-1.5-.4-2.8-1.5-3.8S17.2 3.1 15.7 3C14.2 3 9.8 3 8.3 3c-1.5.1-2.8.4-3.8 1.5S3.1 6.8 3 8.3C3 9.8 3 14.2 3 15.7c.1 1.5.4 2.8 1.5 3.8s2.3 1.4 3.8 1.5c1.5.1 5.9.1 7.4 0 1.5-.1 2.8-.4 3.8-1.5s1.4-2.3 1.5-3.8c.1-1.5.1-5.9 0-7.4zm-2 9.1a3 3 0 01-1.7 1.7c-1.2.5-4 .4-5.3.4s-4.1.1-5.3-.4a3 3 0 01-1.7-1.7c-.5-1.2-.4-4-.4-5.3s-.1-4.1.4-5.3a3 3 0 011.7-1.7C7.9 4.6 10.7 4.7 12 4.7s4.1-.1 5.3.4a3 3 0 011.7 1.7c.5 1.2.4 4 .4 5.3s.1 4.1-.4 5.3z",
  website:
    "M12 3a9 9 0 100 18 9 9 0 000-18zm6.9 8h-3a14 14 0 00-1.3-5.4A7 7 0 0118.9 11zM12 5c.8 1 1.7 3 1.9 6h-3.8c.2-3 1.1-5 1.9-6zM9.4 5.6A14 14 0 008.1 11h-3a7 7 0 014.3-5.4zM5.1 13h3a14 14 0 001.3 5.4A7 7 0 015.1 13zm6.9 6c-.8-1-1.7-3-1.9-6h3.8c-.2 3-1.1 5-1.9 6zm2.6-.6a14 14 0 001.3-5.4h3a7 7 0 01-4.3 5.4z",
  phone: "M6.6 10.8a15.2 15.2 0 006.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 013 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z",
} as const;

export function BrandIcon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 fill-current" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
