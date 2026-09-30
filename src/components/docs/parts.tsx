import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Headings stop below the header, which stays on screen, when a link jumps to them. */
const BELOW_HEADER = "scroll-mt-[calc(var(--header-h)+1.5rem)]";

export function Chapter({ id, n, title, lead, children }: { id: string; n: number; title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn(BELOW_HEADER, "border-t border-white/10 pt-12 first:border-t-0 first:pt-0 sm:pt-14")}>
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">Chapter {String(n).padStart(2, "0")}</p>
      <h2 id={`${id}-title`} className="font-display mt-3 text-3xl font-bold text-white sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">{lead}</p>
      <div className="mt-8 flex flex-col gap-5">{children}</div>
    </section>
  );
}

export function Topic({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <div id={id} className={cn(BELOW_HEADER, "mt-5 flex flex-col gap-4")}>
      <h3 className="font-display text-xl font-semibold text-white">{title}</h3>
      {children}
    </div>
  );
}

export const P = ({ children }: { children: ReactNode }) => <p className="max-w-[70ch] text-[15px] leading-7 text-white/65">{children}</p>;

/** A name from the code or the chain, set apart from the sentence around it. */
export const C = ({ children }: { children: ReactNode }) => <code className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em] text-white/90">{children}</code>;

export const B = ({ children }: { children: ReactNode }) => <strong className="font-semibold text-white">{children}</strong>;

/** A table that scrolls sideways inside its frame on a narrow screen, so the page never does. */
export function Table({ head, rows, className }: { head: string[]; rows: ReactNode[][]; className?: string }) {
  return (
    <div className={cn("panel overflow-x-auto", className)}>
      <table className="w-full min-w-[440px] border-collapse text-left text-sm">
        <thead>
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-white/45">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-white/10">
              {row.map((cell, j) => (
                <td key={j} className={cn("px-4 py-3 align-top leading-relaxed", j === 0 ? "font-medium text-white" : "text-white/65")}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Something the reader must not miss. A brighter edge, nothing more. */
export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="panel panel-strong flex gap-4 p-5 sm:p-6">
      <span aria-hidden="true" className="w-0.5 shrink-0 rounded-full bg-white" />
      <div>
        <p className="font-display text-base font-semibold text-white">{title}</p>
        <div className="mt-1.5 flex flex-col gap-2 text-sm leading-relaxed text-white/65">{children}</div>
      </div>
    </aside>
  );
}

/** Things that happen one after another, numbered down a line. */
export function Steps({ steps }: { steps: Array<{ title: string; text: ReactNode; tag?: string }> }) {
  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => (
        <li key={s.title} className="relative flex gap-4 pb-6 last:pb-0 sm:gap-5">
          {i < steps.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-8 w-px bg-white/15" />}
          <span className="relative grid size-8 shrink-0 place-items-center rounded-full border border-white/25 bg-[var(--surface)] font-mono text-xs text-white">{i + 1}</span>
          <div className="min-w-0 pt-1">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-base font-semibold text-white">{s.title}</span>
              {s.tag && <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">{s.tag}</span>}
            </p>
            <p className="mt-1 max-w-[64ch] text-sm leading-relaxed text-white/60">{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Short points side by side. */
export function Tiles({ items, className = "sm:grid-cols-2" }: { items: Array<{ title: string; text: ReactNode }>; className?: string }) {
  return (
    <div className={cn("grid gap-3", className)}>
      {items.map((t) => (
        <div key={t.title} className="panel p-4 sm:p-5">
          <p className="font-display text-[15px] font-semibold text-white">{t.title}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-white/60">{t.text}</p>
        </div>
      ))}
    </div>
  );
}

/** A path something takes, left to right on a wide screen and top to bottom on a narrow one. */
export function Flow({ stops }: { stops: Array<{ title: string; text: ReactNode }> }) {
  return (
    <ol className="grid gap-2 lg:grid-flow-col lg:auto-cols-fr lg:gap-0">
      {stops.map((s, i) => (
        <li key={s.title} className="flex flex-col lg:flex-row">
          <div className="panel flex-1 p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">{String(i + 1).padStart(2, "0")}</p>
            <p className="font-display mt-1.5 text-[15px] font-semibold leading-snug text-white">{s.title}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-white/60">{s.text}</p>
          </div>
          {i < stops.length - 1 && (
            <span aria-hidden="true" className="grid shrink-0 place-items-center py-0.5 font-mono text-white/35 lg:w-7 lg:py-0">
              <span className="lg:hidden">↓</span>
              <span className="hidden lg:inline">→</span>
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Lines to type into a terminal. */
export function Terminal({ label, children }: { label: string; children: string }) {
  return (
    <figure className="stage overflow-hidden rounded-2xl border border-white/10 bg-black">
      <figcaption className="border-b border-white/10 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/45">{label}</figcaption>
      <pre className="overflow-x-auto px-4 py-4 font-mono text-[12.5px] leading-6 text-white/85">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

/** A question, with its answer folded away until it is asked. */
export function Question({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group border-t border-white/10 last:border-b">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[15px] font-medium text-white [&::-webkit-details-marker]:hidden">
        {q}
        <span aria-hidden="true" className="font-mono text-lg leading-none text-white/40 transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="flex max-w-[70ch] flex-col gap-2 pb-5 text-sm leading-relaxed text-white/65">{children}</div>
    </details>
  );
}
