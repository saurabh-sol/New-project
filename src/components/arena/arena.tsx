"use client";

import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { AgentCards } from "@/components/home/agent-cards";
import { HeroStats } from "@/components/home/hero-stats";
import { AGENT_ORDER } from "@/lib/agents";
import { cn } from "@/lib/utils";
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

/** The trading floor page. The show itself is run by ShowRunner, above the pages. */
export function Arena() {
  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 pb-12 pt-5 sm:px-6">
      <HeroStats />

      {/* The agents, the floor between them and the conversation. On a narrow screen the floor comes first. */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,21rem)] 2xl:grid-cols-[minmax(0,19rem)_minmax(0,1fr)_minmax(0,24rem)]">
        <AgentCards className="order-3 xl:order-none" />
        <div className="order-1 flex min-w-0 flex-col gap-3 xl:order-none">
          <PhaseTimeline />
          {/* Beside the cards the floor takes their height. */}
          <Floor className="xl:aspect-auto xl:min-h-[26rem] xl:flex-1" />
        </div>
        {/* The conversation takes the floor's height, however much has been said. */}
        <div className="order-2 min-w-0 xl:relative xl:order-none">
          <div className="flex xl:absolute xl:inset-0">
            <Transcript frame="w-full" className="h-96 xl:h-auto xl:min-h-0 xl:flex-1" />
          </div>
        </div>
      </div>

      {/* The chart below, with what the desk holds beside it. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <PriceChart />
        <Positions />
      </div>

      <TradeFeed />
    </div>
  );
}

/** The office itself. Everything in it is placed in percent, so it scales with its width. */
export function Floor({ className }: { className?: string }) {
  return (
    <motion.section
      className={cn("stage @container relative isolate aspect-[4/5] w-full overflow-hidden rounded-3xl border border-white/10 bg-[#06080d] shadow-[0_30px_80px_-30px_var(--shade)] sm:aspect-[16/11]", className)}
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
