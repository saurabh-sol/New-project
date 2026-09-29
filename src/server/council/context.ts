/** Everything an agent is told at the start of a round, as text and as structured data. */
import { AGENTS } from "@/lib/agents";
import type { RequestBrief } from "@/lib/assets";
import { agentPnl, canSell, poolCapital, poolEquity, positionOf, unrealized, type Portfolio } from "@/lib/council";
import type { Exchange, Pitch, Proposal, TokenStats } from "@/lib/council-types";
import { priceDecimals, type AssetKey, type Prices } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import type { Effort, Skill } from "./skills";

export interface RoundCtx {
  round: number;
  stats: TokenStats[];
  portfolio: Portfolio;
  prices: Prices;
  /** Tokens the council is allowed to sell this round. */
  sellable: AssetKey[];
  recent: string[];
  /** What each agent said lately, including earlier in this round. Grows as the round goes on. */
  said: Record<AgentId, string[]>;
  /** Everything said by anyone in this round so far. */
  floor: string[];
  /** The analytical focus each agent was handed for this round. */
  lens: Record<AgentId, Skill>;
  /** How hard each agent may think, set by how much users have funded it. */
  effort: Record<AgentId, Effort>;
  /** The funder's trade request this session is hearing, if there is one. */
  request: RequestBrief | null;
}

export const usd = (n: number) => `$${n.toFixed(2)}`;
export const px = (n: number) => `$${n.toFixed(priceDecimals(n))}`;
export const signed = (n: number, unit = "%") => `${n >= 0 ? "+" : ""}${n.toFixed(unit === "" ? 2 : unit === "pp" ? 2 : 1)}${unit}`;
export const nameOf = (a: AgentId) => AGENTS[a].name;

const big = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** What the desk has been asked to do by a funder, and how far that binds it. */
export function describeRequest(ctx: Pick<RoundCtx, "request" | "portfolio" | "prices">): string {
  const r = ctx.request!;
  const who = nameOf(r.agent);
  const rule =
    r.mode === "commit"
      ? `${who} is committed to buy it with up to ${usd(r.usd)} of its own cash, so this trade goes ahead. There is no vote on whether to trade. Every other trader decides one thing: join with its own cash, or stay out.`
      : `${who} presents it once, and the whole desk weighs it. The desk buys it only if 3 of 4 traders back it.`;
  const held = positionOf(ctx.portfolio, r.asset.key);
  const now = held ? (ctx.prices[held.token] ?? held.entryPrice) : 0;
  return [
    `A user who funded ${who} with ${usd(r.usd)} asked the desk to buy ${r.asset.key} (${r.asset.name}), a Solana token traded on a DEX pool with ${big(r.liquidityUsd)} of liquidity.`,
    rule,
    ...(held
      ? [
          `The desk already holds ${usd(held.cost)} of ${r.asset.key}, bought at ${px(held.entryPrice)} (${signed((unrealized(held, now) / held.cost) * 100)} since). This purchase adds to it.`,
          `The desk has debated ${r.asset.key} before. Do not go over the same ground: say only what has changed since, in a few words.`,
        ]
      : []),
    "Judge it on the data, like any other trade. A funder's wish is not evidence.",
  ].join("\n");
}

export function marketTable(stats: TokenStats[]): string {
  const rows = stats.map((s) =>
    [
      s.token.padEnd(5),
      `price ${px(s.price)}`,
      `15m ${signed(s.change15m)}`,
      `1h ${signed(s.change1h)}`,
      `4h ${signed(s.change4h)}`,
      `24h ${signed(s.change24h)}`,
      `RSI14(5m) ${s.rsi14}`,
      `trend ${s.trend}`,
      s.volRatio === null ? "volume n/a" : `volume x${s.volRatio} of average`,
      `volatility ${s.atrPct}% per 5m`,
      `at ${s.rangePos}% of 24h range`,
      s.token === "SOL" ? null : `vs SOL 1h ${signed(s.vsSol1h, "pp")}`,
      `1h range ${px(s.low1h)} to ${px(s.high1h)}`,
      s.pool ? `DEX pool, liquidity ${big(s.pool.liquidityUsd)}, 24h volume ${big(s.pool.volume24hUsd)}` : null,
    ]
      .filter(Boolean)
      .join(" | "),
  );
  return rows.join("\n");
}

function deskReport(ctx: RoundCtx, agent: AgentId): string {
  const p = ctx.portfolio;
  const lines = [
    `Pool equity: ${usd(poolEquity(p, ctx.prices))} on ${usd(poolCapital(p))} of capital.`,
    `Your cash: ${usd(p.cash[agent])}. Your PnL so far: ${signed(agentPnl(p, agent, ctx.prices), "")} USDC.`,
    "Open positions:",
  ];
  if (p.positions.length === 0) lines.push("- none");
  for (const pos of p.positions) {
    const now = ctx.prices[pos.token] ?? pos.entryPrice;
    lines.push(
      `- ${pos.token}: ${usd(pos.cost)} in at ${px(pos.entryPrice)}, now ${px(now)} (${signed((unrealized(pos, now) / pos.cost) * 100)}), ` +
        `held ${ctx.round - pos.openedRound} rounds, stop ${px(pos.stop)}, target ${px(pos.target)}, led by ${nameOf(pos.leader)}. ` +
        `Your stake ${usd(pos.stake[agent])}. Can be sold this round: ${
          canSell(p, pos.token, ctx.round) ? "yes" : ctx.round < (pos.lockedUntil ?? 0) ? `no, bought for a funder and held until round ${pos.lockedUntil}` : "no, too new"
        }.`,
    );
  }
  return lines.join("\n");
}

export function briefing(ctx: RoundCtx, agent: AgentId): string {
  return [
    `ROUND ${ctx.round}`,
    "",
    "MARKET (live spot prices, USDT pairs)",
    marketTable(ctx.stats),
    "",
    ...(ctx.request ? ["A FUNDER'S REQUEST THIS ROUND", describeRequest(ctx), ""] : []),
    "DESK",
    deskReport(ctx, agent),
    "",
    "RECENT ROUNDS",
    ctx.recent.length ? ctx.recent.map((r) => `- ${r}`).join("\n") : "- none yet",
  ].join("\n");
}

export function describeProposal(p: Proposal): string {
  return p.action === "BUY"
    ? `${nameOf(p.leader)} proposes to BUY ${p.token} with a ${p.stopPct}% stop-loss and a ${p.targetPct}% profit target.`
    : `${nameOf(p.leader)} proposes to SELL ${p.sellPct}% of the desk's ${p.token} position.`;
}

export function describePitches(pitches: Pitch[]): string {
  return pitches
    .map((p) => {
      const what = p.action === "HOLD" ? "HOLD" : p.action === "BUY" ? `BUY ${p.token}, staking ${usd(p.stakeUsd)}` : `SELL ${p.token}`;
      return `- ${nameOf(p.agent)} (${what}, conviction ${p.conviction}/5): "${p.say}"`;
    })
    .join("\n");
}

export function describeDebate(exchanges: Exchange[]): string {
  return exchanges
    .flatMap((e) => [
      `- ${nameOf(e.challenge.agent)} to ${nameOf(e.reply.agent)}: "${e.challenge.say}"`,
      `- ${nameOf(e.reply.agent)} replied: "${e.reply.say}"`,
    ])
    .join("\n");
}

/** Structured version of the briefing for the evaluation model. */
export function briefingState(ctx: RoundCtx, agent: AgentId) {
  return {
    round: ctx.round,
    funderRequest: ctx.request ? describeRequest(ctx) : null,
    market: ctx.stats.map((s) => ({
      token: s.token,
      dexPoolLiquidityUsd: s.pool?.liquidityUsd ?? null,
      priceUsd: s.price,
      change15mPct: +s.change15m.toFixed(2),
      change1hPct: +s.change1h.toFixed(2),
      change4hPct: +s.change4h.toFixed(2),
      change24hPct: +s.change24h.toFixed(2),
      rsi14On5mCandles: s.rsi14,
      trend: s.trend,
      volumeVsAverage: s.volRatio,
      volatilityPctPer5m: s.atrPct,
      positionIn24hRangePct: s.rangePos,
      vsSol1hPctPoints: s.vsSol1h,
      low1h: s.low1h,
      high1h: s.high1h,
    })),
    desk: {
      myCashUsd: ctx.portfolio.cash[agent],
      openPositions: ctx.portfolio.positions.map((pos) => ({
        token: pos.token,
        entryPrice: pos.entryPrice,
        stopPrice: pos.stop,
        targetPrice: pos.target,
        roundsHeld: ctx.round - pos.openedRound,
      })),
    },
  };
}
