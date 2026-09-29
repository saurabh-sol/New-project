"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ModeBadge } from "@/components/arena/mode-badge";
import { ConnectButton } from "@/components/wallet/connect-button";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { Ticker } from "./ticker";

const NAV = [
  { href: "/", label: "Trading floor" },
  { href: "/fund", label: "Fund an agent" },
  { href: "/claim", label: "Rewards" },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-[3000] border-b border-white/5 bg-black/80 backdrop-blur-xl">
      {/* On a phone the pages get a row of their own, so none is hidden behind the wallet button. */}
      <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:flex-nowrap sm:px-6 sm:py-3">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          <Logo />
          <span className="flex flex-col leading-none">
            <span className="font-display text-base font-bold tracking-tight text-white sm:text-lg">The Council</span>
            <span className="mt-1 text-[9px] uppercase tracking-[0.2em] text-white/40 sm:text-[10px]">AI trading desk</span>
          </span>
        </Link>

        <nav className="order-last -mx-1 flex w-full items-center gap-1 overflow-x-auto [scrollbar-width:none] sm:order-none sm:mx-0 sm:w-auto" aria-label="Main">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex-1 whitespace-nowrap rounded-full px-3 py-1.5 text-center text-[13px] transition-colors sm:flex-none sm:px-3.5 sm:text-sm",
                  active ? "bg-white/10 text-white" : "text-white/55 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <ModeBadge />
          <ThemeToggle />
          <ConnectButton />
        </div>
      </div>
      <Ticker />
    </header>
  );
}
