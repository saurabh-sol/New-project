"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface Chapter {
  id: string;
  title: string;
}

/** The chapter the reader is in: the last one whose heading has passed under the header. */
function useCurrent(chapters: Chapter[]) {
  const [current, setCurrent] = useState(chapters[0]?.id);

  useEffect(() => {
    const find = () => {
      const line = window.innerHeight * 0.3;
      let found = chapters[0]?.id;
      for (const c of chapters) {
        const el = document.getElementById(c.id);
        if (el && el.getBoundingClientRect().top <= line) found = c.id;
      }
      setCurrent(found);
    };
    find();
    window.addEventListener("scroll", find, { passive: true });
    window.addEventListener("resize", find);
    return () => {
      window.removeEventListener("scroll", find);
      window.removeEventListener("resize", find);
    };
  }, [chapters]);

  return current;
}

/** The chapters, beside the text on a wide screen and above it on a narrow one. */
export function Contents({ chapters }: { chapters: Chapter[] }) {
  const current = useCurrent(chapters);

  return (
    <nav aria-label="On this page">
      <p className="panel-title">On this page</p>
      <ol className="mt-3 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3 lg:grid-cols-1 lg:gap-0 lg:border-l lg:border-white/10">
        {chapters.map((c, i) => {
          const active = c.id === current;
          return (
            <li key={c.id}>
              <a
                href={`#${c.id}`}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex items-baseline gap-2.5 py-1.5 text-[13px] leading-snug transition-colors lg:-ml-px lg:border-l lg:pl-4",
                  active ? "text-white lg:border-white" : "text-white/50 hover:text-white lg:border-transparent",
                )}
              >
                <span className="font-mono text-[10px] text-white/35">{String(i + 1).padStart(2, "0")}</span>
                {c.title}
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
