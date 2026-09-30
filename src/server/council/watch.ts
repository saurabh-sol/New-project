/**
 * When the desk trades on the market, its positions are looked over all the time, not only
 * while a page is open: a position that has made or lost enough is sold, and a vote the desk
 * has called is held. It runs for as long as the server does. A server that sleeps watches nothing.
 */
import { realTrading } from "../chains/wallets";
import { realRisk } from "./real";
import { joinRound } from "./session";
import { readState } from "./store";

const EVERY_MS = 15_000;
const shared = globalThis as typeof globalThis & { __realWatch?: ReturnType<typeof setInterval>; __realWatching?: boolean };

async function look(): Promise<void> {
  if (shared.__realWatching) return;
  shared.__realWatching = true;
  try {
    await realRisk();
    const s = await readState();
    // A vote on selling a position is held at once, whether or not anyone is watching.
    if (s.sellCall && s.sellCall.at > s.lastRoundAt) await joinRound(Number.MAX_SAFE_INTEGER);
  } catch (e) {
    console.error("[real] the watch could not look:", e instanceof Error ? e.message.split("\n")[0] : e);
  } finally {
    shared.__realWatching = false;
  }
}

/** Starts the watch, once. Does nothing unless the desk trades on the market. */
export function startRealWatch(): void {
  if (shared.__realWatch || !realTrading()) return;
  shared.__realWatch = setInterval(() => void look(), EVERY_MS);
  console.log("[real] the desk trades on the market: its positions are looked over every 15 seconds");
}
