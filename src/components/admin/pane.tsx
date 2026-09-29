import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A window of the admin's terminal: a title bar, the command it would be running, and what that prints. */
export function Pane({ title, command, aside, className, children }: { title: string; command?: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={cn("flex min-w-0 flex-col border border-white/15 bg-black", className)}>
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/15 bg-white/[0.06] px-[1ch] py-0.5 text-[0.85em]">
        <span className="shrink-0 text-white/80">{title}</span>
        {aside && <span className="truncate text-white/35">{aside}</span>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-[1ch] py-1">
        {command && (
          <div className="shrink-0 truncate text-white/40">
            <span className="text-white/70">council@desk</span>:~$ {command}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
