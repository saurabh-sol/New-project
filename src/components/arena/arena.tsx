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
import { RecentTrades } from "./recent-trades";
import { Scene } from "./scene";
import { TradeFeed } from "./trade-feed";
import { Transcript } from "./transcript";

// Everything on the floor scales with the floor. The unit is a hundredth of its width. On a floor
// wider than the one the office was drawn for, it is a hundredth of the width that would go with its height.
const SIZES = {
  "--u": "min(1cqw, 1.4545cqh)",
  "--char-w": "clamp(34px, calc(var(--u) * 8.5), 84px)",
  "--char-h": "calc(var(--char-w) * 1.55)",
  "--desk-w": "clamp(84px, calc(var(--u) * 21), 200px)",
  "--table-w": "clamp(100px, calc(var(--u) * 24), 230px)",
} as CSSProperties;

/** A column of the wide layout. On a narrow screen it is no box at all, and what is in it takes its place in the page's one column. */
const COLUMN = "contents xl:flex xl:min-h-0 xl:min-w-0 xl:flex-col xl:gap-3";

/**
 * The trading floor page. The show itself is run by ShowRunner, above the pages.
 *
 * On a wide screen everything the desk is doing fits on one screen: the agents and what they
 * hold on the left, the floor and the chart in the middle, the conversation and the latest
 * trades on the right. The full order history is below it. On a narrow screen the same parts
 * follow one another, the floor first.
 */
export function Arena() {
  return (
    <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-4 pb-10 pt-4 sm:px-6 xl:gap-3 xl:px-4 xl:pt-3">
      <div className="flex flex-col gap-4 xl:grid xl:h-[calc(100dvh-var(--header-h)-1.5rem)] xl:min-h-[40rem] xl:grid-cols-[17.5rem_minmax(0,1fr)_21rem] xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-3 2xl:grid-cols-[19rem_minmax(0,1fr)_24rem]">
        <HeroStats className="order-1 xl:order-none xl:col-span-3" />

        <div className={COLUMN}>
          <AgentCards className="order-5 xl:order-none" />
          <Positions className="order-7 xl:order-none xl:min-h-0 xl:flex-1" />
        </div>

        <div className={COLUMN}>
          <div className="order-2 flex min-w-0 flex-col gap-3 xl:order-none xl:min-h-0 xl:flex-[3]">
            <PhaseTimeline />
            <Floor className="xl:aspect-auto xl:min-h-0 xl:flex-1" />
          </div>
          <PriceChart className="order-4 xl:order-none xl:min-h-0 xl:flex-[2]" />
        </div>

        <div className={COLUMN}>
          <Transcript frame="order-3 xl:order-none xl:min-h-0 xl:flex-[3]" className="h-96 xl:h-auto xl:min-h-0 xl:flex-1" />
          <RecentTrades className="order-6 xl:order-none xl:min-h-0 xl:flex-[2]" />
        </div>
      </div>

      <TradeFeed />
    </div>
  );
}

/** The office itself. Everything in it is placed in percent, so it scales with its width. */
export function Floor({ className }: { className?: string }) {
  return (
    <motion.section
      className={cn("stage relative isolate aspect-[4/5] [container-type:size] w-full overflow-hidden rounded-3xl border border-white/10 bg-[#06080d] shadow-[0_30px_80px_-30px_var(--shade)] sm:aspect-[16/11]", className)}
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
