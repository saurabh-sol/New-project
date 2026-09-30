"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** A contract's address, written out in full, with a button to copy it. With `href` it links to the block explorer; without, it is text. */
export function Address({ value, href, className }: { value: string; href?: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Some browsers keep the clipboard from a page that is not on https. The older way still works there.
      const field = document.createElement("textarea");
      field.value = value;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      const done = document.execCommand("copy");
      field.remove();
      if (done) setCopied(true);
    }
  };

  return (
    <span className={cn("flex min-w-0 items-center gap-2", className)}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="min-w-0 break-all font-mono text-[12.5px] leading-snug text-white/85 underline decoration-white/25 underline-offset-4 hover:decoration-white">
          {value}
        </a>
      ) : (
        <span className="min-w-0 select-all break-all font-mono text-[12.5px] leading-snug text-white/85">{value}</span>
      )}
      <button type="button" onClick={copy} aria-label={`Copy ${value}`} className="btn-ghost shrink-0 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider">
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
