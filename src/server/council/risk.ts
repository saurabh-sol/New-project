/**
 * What happens to a position between sessions: its stop-loss and profit target, and an
 * agent selling its own tokens because their price is falling fast.
 */
import { AGENT_ORDER } from "@/lib/agents";
import type { AssetQuote } from "@/lib/assets";
import { sell, type Fill, type Portfolio, type Position } from "@/lib/council";
import { isToken } from "@/lib/market";
import type { AgentId } from "@/lib/types";
import { nameOf, px, signed } from "./context";
import { extremesSince, refreshAssets } from "./stats";
import type { CouncilState } from "./store";

const MIN_GAP_MS = 20_000;
/**
 * Each check looks again at the last minute and a half before the previous one. The candle that
 * was still forming then, and candles that were read from a slightly old copy, get a second look.
 */
const LOOK_BACK_MS = 90_000;

/**
 * How far a token must fall before each agent sells what it holds of it, in percent: within
 * five minutes, or within the hour. The risk manager lets go first, the momentum trader last.
 */
const NERVE: Record<AgentId, { m5: number; h1: number }> = {
  guardian: { m5: 4, h1: 9 },
  quant: { m5: 5, h1: 11 },
  oracle: { m5: 5.5, h1: 12 },
  degen: { m5: 7, h1: 15 },
};
/** A position is given this long before a fall can close it. The minutes before the purchase are not its fall. */
const SETTLE_MS = 3 * 60_000;
/** Fewer trades than this in five minutes say nothing about who leads. */
const FEW_TRADES = 6;
/** A quote older than this is not acted on. */
const STALE_MS = 60_000;

/**
 * Why this agent would sell its tokens now, or null if it would hold.
 * A fall counts when sellers lead it. Where too few trades were made to tell, it has to be half as deep again.
 */
export function falling(agent: AgentId, pos: Position, quote: AssetQuote): string | null {
  if (quote.change5m === undefined) return null;
  const traded = (quote.buys5m ?? 0) + (quote.sells5m ?? 0);
  const told = quote.buys5m !== undefined && quote.sells5m !== undefined && traded >= FEW_TRADES;
  if (told && quote.sells5m! <= quote.buys5m!) return null;
  const harder = told ? 1 : 1.5;
  // A position with a wide stop was opened in a token that swings. A fall has to be large for that token, too.
  const stopPct = pos.entryPrice > 0 ? ((pos.entryPrice - pos.stop) / pos.entryPrice) * 100 : 0;
  const flow = told ? `, with ${quote.sells5m} sells to ${quote.buys5m} buys` : "";

  const drop5 = -quote.change5m;
  if (drop5 >= Math.max(NERVE[agent].m5, stopPct * 0.5) * harder) return `down ${drop5.toFixed(1)}% in five minutes${flow}`;
  const drop1h = -(quote.change1h ?? 0);
  if (drop1h >= NERVE[agent].h1 * harder && drop5 > 0.5) return `down ${drop1h.toFixed(1)}% in an hour and still falling${flow}`;
  return null;
}

/**
 * Closes any position whose stop or target was reached since the last check, and sells the
 * tokens of any agent that judges their price to be falling fast.
 *
 * A token priced by its pool is checked against its live price, and sold at that price.
 * ETH and Stock Tokens are checked against one-minute candles and sold at the stop or target;
 * if one candle touched both, the stop is assumed to have been hit first.
 */
export async function applyRisk(state: CouncilState, now = Date.now()): Promise<CouncilState> {
  if (state.portfolio.positions.length === 0 || now - state.lastRiskCheck < MIN_GAP_MS) return state;

  let portfolio: Portfolio = state.portfolio;
  const fills: Fill[] = [];
  const recent: string[] = [];
  let unread = false;

  const assets = await refreshAssets(state.assets, state.portfolio.positions.map((p) => p.token)).catch(() => state.assets);
  const close = (pos: Position, price: number, reason: "STOP" | "TARGET", ts: number, id: string) => {
    const done = sell(portfolio, { token: pos.token, price, fraction: 1, reason, round: state.round, leader: pos.leader, ts, id });
    if (!done) return;
    portfolio = done.portfolio;
    fills.push(done.fill);
    recent.push(`${reason === "STOP" ? "Stop-loss" : "Profit target"} hit on ${pos.token} at ${px(done.fill.price)}: ${signed(done.fill.realized ?? 0, "")} USDG (position led by ${nameOf(pos.leader)}).`);
  };

  for (const pos of state.portfolio.positions) {
    const asset = assets[pos.token];
    if (asset && !isToken(pos.token) && asset.kind === "pool") {
      // A quote that could not be refreshed is an old one. Better to look again than to act on it.
      if (now - asset.quotedAt > STALE_MS || !(asset.quote.price > 0)) {
        unread = true;
        continue;
      }
      const { quote } = asset;
      if (quote.price <= pos.stop) close(pos, quote.price, "STOP", now, `stop-${pos.token}-${now}`);
      else if (quote.price >= pos.target) close(pos, quote.price, "TARGET", now, `target-${pos.token}-${now}`);
      else if (now - pos.openedAt >= SETTLE_MS && state.round >= (pos.lockedUntil ?? 0)) {
        for (const agent of AGENT_ORDER) {
          if (pos.stake[agent] < 0.01) continue;
          const why = falling(agent, pos, quote);
          if (!why) continue;
          const done = sell(portfolio, { token: pos.token, price: quote.price, fraction: 1, reason: "FALLING", round: state.round, leader: agent, ts: now, id: `falling-${pos.token}-${agent}-${now}`, only: agent });
          if (!done) continue;
          portfolio = done.portfolio;
          const note = `${nameOf(agent)} sold its ${pos.token} at ${px(quote.price)}: ${why}. Realized ${signed(done.fill.realized ?? 0, "")} USDG.`;
          fills.push({ ...done.fill, note });
          recent.push(note);
        }
      }
      continue;
    }

    const since = Math.max(state.lastRiskCheck - LOOK_BACK_MS, pos.openedAt);
    // A token whose candles can't be read is checked again next time, from the same point. The others are not held up by it.
    const candles = await extremesSince(pos.token, since, now, assets).catch(() => null);
    if (!candles) {
      unread = true;
      continue;
    }
    // Skip the candle the position was opened in: its low and high include prices from before the entry.
    const hit = candles.find((c) => c.time * 1000 > pos.openedAt && (c.time + 60) * 1000 > since && (c.low <= pos.stop || c.high >= pos.target));
    if (!hit) continue;
    const stopped = hit.low <= pos.stop;
    close(pos, stopped ? pos.stop : pos.target, stopped ? "STOP" : "TARGET", Math.min((hit.time + 60) * 1000, now), `${stopped ? "stop" : "target"}-${pos.token}-${hit.time}`);
  }

  return { ...state, portfolio, assets, fills: [...state.fills, ...fills], recent: [...state.recent, ...recent], lastRiskCheck: unread ? state.lastRiskCheck : now };
}
