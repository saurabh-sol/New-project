"use client";

import { motion } from "motion/react";
import { useEffect, type CSSProperties } from "react";
import { AgentCards } from "@/components/home/agent-cards";
import { HeroStats } from "@/components/home/hero-stats";
import { AGENT_ORDER } from "@/lib/agents";
import { startShow } from "@/lib/director";
import { cn } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { livePrices, startQuotes, useMarket } from "@/store/market";
import { PriceChart } from "../market/price-chart";
import { AgentActor } from "./agent-actor";
import { CouncilTable } from "./council-table";
import { Desk } from "./desk";
import { EffectsLayer } from "./effects-layer";
import { Overlays } from "./overlays";
import { PhaseTimeline } from "./phase-timeline";
import { Positions } from "./positions";
import { Scene } from "./scene";
import { TradeFeed } from "./trade-feed";
import { Transcript } from "./transcript";

// Everything on the floor scales with the arena's width.
const SIZES = {
  "--char-w": "clamp(40px, 8.5cqw, 84px)",
  "--char-h": "calc(var(--char-w) * 1.55)",
  "--desk-w": "clamp(96px, 21cqw, 200px)",
  "--table-w": "clamp(110px, 24cqw, 230px)",
} as CSSProperties;

/** Starts the live prices and the council's show. Used by every page that displays the floor. */
export function useCouncilShow() {
  const apply = useArena((s) => s.apply);
  const samplePnl = useArena((s) => s.samplePnl);
  const feedSettled = useMarket((s) => s.status !== "loading");

  useEffect(() => startQuotes(), []);

  // Wait for the first real quotes so the desk opens on real prices.
  useEffect(() => {
    if (feedSettled) return startShow(apply);
  }, [feedSettled, apply]);

  // Sample each agent's PnL for the sparklines.
  useEffect(() => {
    if (!feedSettled) return;
    const id = setInterval(() => samplePnl(livePrices()), 10_000);
    return () => clearInterval(id);
  }, [feedSettled, samplePnl]);
}

export function Arena() {
  useCouncilShow();

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 pb-12 pt-5 sm:px-6">
      <HeroStats />

      {/* Floor and chart share the first screen. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3">
          <PhaseTimeline />
          <Floor />
        </div>
        <PriceChart />
      </div>

      <AgentCards />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Positions />
        <Transcript />
      </div>

      <TradeFeed />
    </div>
  );
}

/** The office itself. Everything in it is placed in percent, so it scales with its width. */
export function Floor({ className }: { className?: string }) {
  return (
    <motion.section
      className={cn("@container relative isolate aspect-[4/5] w-full overflow-hidden rounded-3xl border border-white/10 bg-[#06080d] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.9)] sm:aspect-[16/11]", className)}
      style={SIZES}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6 }}
      aria-label="Trading floor"
    >
      <Scene />
      <CouncilTable />
      {AGENT_ORDER.map((id) => (
        <Desk key={id} id={id} />
      ))}
      {AGENT_ORDER.map((id, i) => (
        <AgentActor key={id} id={id} index={i} />
      ))}
      <EffectsLayer />
      <Overlays />
    </motion.section>
  );
}
