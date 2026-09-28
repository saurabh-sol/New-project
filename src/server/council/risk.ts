/** Stop-loss and profit-target exits, checked against real 1-minute candles. */
import { sell, type Fill } from "@/lib/council";
import { fetchCandles } from "@/lib/market";
import { nameOf, px, signed } from "./context";
import type { CouncilState } from "./store";

const MIN_GAP_MS = 20_000;

/**
 * Closes any position whose stop or target was touched since the last check.
 * Fills at the stop or target price. If one candle touched both, the stop is
 * assumed to have been hit first.
 */
export async function applyRisk(state: CouncilState, now = Date.now()): Promise<CouncilState> {
  if (state.portfolio.positions.length === 0 || now - state.lastRiskCheck < MIN_GAP_MS) return state;

  let portfolio = state.portfolio;
  const fills: Fill[] = [];
  const recent: string[] = [];

  for (const pos of state.portfolio.positions) {
    const since = Math.max(state.lastRiskCheck, pos.openedAt);
    const minutes = Math.min(Math.ceil((now - since) / 60_000) + 1, 1000);
    const candles = await fetchCandles(pos.token, "1m", minutes, AbortSignal.timeout(10_000));
    // Skip the candle the position was opened in: its low and high include prices from before the entry.
    const hit = candles.find((c) => c.time * 1000 > since && (c.low <= pos.stop || c.high >= pos.target));
    if (!hit) continue;

    const stopped = hit.low <= pos.stop;
    const done = sell(portfolio, {
      token: pos.token,
      price: stopped ? pos.stop : pos.target,
      fraction: 1,
      reason: stopped ? "STOP" : "TARGET",
      round: state.round,
      leader: pos.leader,
      ts: Math.min((hit.time + 60) * 1000, now),
      id: `${stopped ? "stop" : "target"}-${pos.token}-${hit.time}`,
    });
    if (!done) continue;
    portfolio = done.portfolio;
    fills.push(done.fill);
    recent.push(
      `${stopped ? "Stop-loss" : "Profit target"} hit on ${pos.token} at ${px(done.fill.price)}: ${signed(done.fill.realized ?? 0, "")} USDC (position led by ${nameOf(pos.leader)}).`,
    );
  }

  return { ...state, portfolio, fills: [...state.fills, ...fills], recent: [...state.recent, ...recent], lastRiskCheck: now };
}
