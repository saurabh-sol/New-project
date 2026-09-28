"use client";

import { motion } from "motion/react";
import { useEffect, type CSSProperties } from "react";
import { AGENT_ORDER } from "@/lib/agents";
import { startShow } from "@/lib/director";
import { useArena } from "@/store/arena";
import { livePrices, startQuotes, useMarket } from "@/store/market";
import { PriceChart } from "../market/price-chart";
import { AgentActor } from "./agent-actor";
import { CouncilTable } from "./council-table";
import { Desk } from "./desk";
import { EffectsLayer } from "./effects-layer";
import { Leaderboard } from "./leaderboard";
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

export function Arena() {
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

  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 pb-10 sm:px-6">
      <PhaseTimeline />

      {/* Floor and chart share the first screen. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <motion.section
          className="@container relative isolate aspect-[4/5] w-full overflow-hidden rounded-3xl border border-white/10 bg-[#06080d] sm:aspect-[16/11]"
          style={SIZES}
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6 }}
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
        <PriceChart />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[390px_minmax(0,1fr)_minmax(0,1.2fr)]">
        <Leaderboard />
        <Positions />
        <div className="lg:col-span-2 xl:col-span-1">
          <Transcript />
        </div>
      </div>

      <TradeFeed />
    </div>
  );
}
