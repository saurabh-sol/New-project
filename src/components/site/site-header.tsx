"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ModeBadge } from "@/components/arena/mode-badge";
import { ConnectButton } from "@/components/wallet/connect-button";
import { cn } from "@/lib/utils";
import { Logo } from "./logo";
import { Ticker } from "./ticker";

const NAV = [
  { href: "/", label: "Trading floor" },
  { href: "/fund", label: "Fund an agent" },
  { href: "/claim", label: "Rewards" },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-[3000] border-b border-white/5 bg-[#05070c]/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1440px] items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-3">
          <Logo />
          <span className="hidden flex-col leading-none sm:flex">
            <span className="font-display text-lg font-bold tracking-tight text-white">The Council</span>
            <span className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/40">AI trading desk</span>
          </span>
        </Link>

        <nav className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]" aria-label="Main">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm transition-colors",
                  active ? "bg-white/10 text-white" : "text-white/55 hover:text-white",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <ModeBadge />
          <ConnectButton />
        </div>
      </div>
      <Ticker />
    </header>
  );
}
