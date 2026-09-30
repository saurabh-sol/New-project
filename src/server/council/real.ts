/**
 * The desk on the market.
 *
 * When every agent has a wallet, a trade is a swap, and the books follow what the swaps did:
 * what was paid, what came back, and the transaction of each. Between sessions the desk asks
 * the chain what each position would bring if it were sold now, and acts on that figure:
 *
 *   a position one agent holds is sold by that agent once it is up or down by a set amount;
 *   a position several hold is sold once it is up or down by a set amount, and before that,
 *   once it is up by less, its sale is put to a vote in a session called at once.
 *
 * A swap is made first and written into the books afterwards, never inside a change to the
 * books, which may run twice.
 */
import { AGENT_ORDER } from "@/lib/agents";
import type { DeskAsset } from "@/lib/assets";
import { exitFor, EXITS, sell, zeroStakes, type Fill, type Position, type RealSale, type Stakes } from "@/lib/council";
import type { AgentId } from "@/lib/types";
import { NoTrade, realBuy, realSell, realTrading, sellValue, walletCash } from "../chains/wallets";
import { nameOf, px, signed, usd } from "./context";
import { readState, updateState, type CouncilState } from "./store";

/** Positions are looked at no more often than this. */
const MIN_GAP_MS = 10_000;
/** A vote on selling the same position is not called again sooner than this. */
const CALL_AGAIN_MS = 10 * 60_000;
const ONE_CENT = 0.01;

const shared = globalThis as typeof globalThis & { __real?: { turn: Promise<unknown>; checking: Promise<void> | null; last: number } };
const memo = () => (shared.__real ??= { turn: Promise.resolve(), checking: null, last: 0 });
const sum = (s: Stakes) => AGENT_ORDER.reduce((t, a) => t + s[a], 0);
const said = (e: unknown) => (e instanceof Error ? e.message.split("\n")[0] : String(e));

/** Runs one piece of trading at a time: a swap and the entry it makes in the books belong together. */
export function inRealTurn<T>(work: () => Promise<T>): Promise<T> {
  const m = memo();
  const run = m.turn.then(work);
  m.turn = run.catch(() => {});
  return run;
}

/** A purchase as the wallets made it: what each agent paid and got. `why` says why none was made. */
export interface RealPurchase {
  stakes: Stakes;
  units: Stakes;
  txs: Partial<Record<AgentId, string>>;
  why: string | null;
}

/**
 * Buys a token for each agent that put a stake in, one after another. An agent whose swap
 * fails is left out. If the desk refuses the purchase for the first of them, nobody buys.
 */
export async function buyTogether(asset: DeskAsset | undefined, stakes: Stakes): Promise<RealPurchase> {
  const out: RealPurchase = { stakes: zeroStakes(), units: zeroStakes(), txs: {}, why: null };
  for (const agent of AGENT_ORDER) {
    if (!(stakes[agent] >= ONE_CENT)) continue;
    try {
      const fill = await realBuy(agent, asset, stakes[agent]);
      out.stakes[agent] = fill.usd;
      out.units[agent] = fill.units;
      out.txs[agent] = fill.tx;
    } catch (e) {
      console.error(`[real] ${agent} could not buy ${asset?.symbol}:`, said(e));
      out.why ??= e instanceof NoTrade ? e.message : `${nameOf(agent)}'s swap did not go through`;
      // What the desk refuses for one, it refuses for all.
      if (e instanceof NoTrade) break;
    }
  }
  return out;
}

/** Sells a share of a token for each of the agents named, one after another. Null if none of them sold anything. */
export async function sellTogether(asset: DeskAsset | undefined, sellers: AgentId[], fraction: number): Promise<RealSale | null> {
  const out: RealSale = { units: zeroStakes(), usd: zeroStakes(), txs: {} };
  for (const agent of sellers) {
    try {
      const fill = await realSell(agent, asset, fraction);
      if (!fill) continue;
      out.units[agent] = fill.units;
      out.usd[agent] = fill.usd;
      out.txs[agent] = fill.tx;
    } catch (e) {
      console.error(`[real] ${agent} could not sell ${asset?.symbol}:`, said(e));
    }
  }
  return sum(out.units) > 0 ? out : null;
}

/** The price a sale or a purchase was made at, over all who took part. */
export const priceOf = (usdBy: Stakes, unitsBy: Stakes) => (sum(unitsBy) > 0 ? sum(usdBy) / sum(unitsBy) : 0);

const holdersOf = (pos: Position) => AGENT_ORDER.filter((a) => pos.stake[a] > 0.005);

/** The first time the desk runs with wallets: what it had on record before was never on the market, and is closed. Cash is what the wallets hold. */
async function enter(): Promise<CouncilState> {
  const cash = await walletCash();
  const since = Date.now();
  return updateState((s) =>
    s.real
      ? s
      : {
          ...s,
          real: { since },
          desk: undefined,
          portfolio: { ...s.portfolio, cash, positions: [] },
          recent: [...s.recent, "The desk now trades on the market: every purchase is a swap from an agent's own wallet. The positions it had on record before were closed."],
        },
  );
}

/** The books' cash follows the wallets. Anything else would be a figure nobody holds. */
async function reconcile(): Promise<void> {
  const cash = await walletCash().catch(() => null);
  if (!cash) return;
  await updateState((s) => (AGENT_ORDER.every((a) => Math.abs(s.portfolio.cash[a] - cash[a]) < ONE_CENT) ? s : { ...s, portfolio: { ...s.portfolio, cash } }));
}

async function look(): Promise<void> {
  let state = await readState();
  if (!state.real) state = await enter();
  await reconcile();

  for (const pos of state.portfolio.positions) {
    const asset = state.assets[pos.token];
    const holders = holdersOf(pos);
    if (!asset || holders.length === 0) continue;
    const worth = await Promise.all(holders.map((a) => sellValue(a, asset)));
    // A position the chain can't put a figure on is looked at again next time.
    if (worth.some((w) => w === null)) continue;
    const pnl = worth.reduce<number>((t, w) => t + (w ?? 0), 0) - holders.reduce((t, a) => t + pos.stake[a], 0);
    const exit = exitFor(holders.length, pnl);
    if (!exit) continue;
    const now = Date.now();

    if (exit === "CALL") {
      await updateState((s) => {
        if (s.sellCall || now - (s.called?.[pos.token] ?? 0) < CALL_AGAIN_MS) return s;
        return { ...s, sellCall: { token: pos.token, at: now, pnl: Math.round(pnl * 100) / 100 }, called: { ...s.called, [pos.token]: now } };
      });
      continue;
    }

    const sale = await sellTogether(asset, holders, 1);
    if (!sale) continue;
    const alone = holders.length === 1;
    const reason = exit === "GAIN" ? "TARGET" : "STOP";
    let made: Fill | null = null;
    await updateState((s) => {
      const done = sell(s.portfolio, { token: pos.token, price: priceOf(sale.usd, sale.units), fraction: 1, reason, round: s.round, leader: pos.leader, ts: now, id: `${reason.toLowerCase()}-${pos.token}-${now}`, real: sale });
      if (!done) return s;
      const result = done.fill.realized ?? 0;
      const who = alone ? nameOf(holders[0]) : "The desk";
      const note =
        exit === "GAIN"
          ? `${who} took the profit on ${pos.token}: sold at ${px(done.fill.price)} for ${usd(done.fill.usd)}, ${signed(result, "")} USDG. Up ${usd(alone ? EXITS.solo.gain : EXITS.council.gain)} or more, a position is sold.`
          : `${who} cut the loss on ${pos.token}: sold at ${px(done.fill.price)} for ${usd(done.fill.usd)}, ${signed(result, "")} USDG. Down ${usd(alone ? EXITS.solo.loss : EXITS.council.loss)} or more, a position is sold.`;
      made = { ...done.fill, note };
      return { ...s, portfolio: done.portfolio, fills: [...s.fills, made], recent: [...s.recent, note], sellCall: s.sellCall?.token === pos.token ? undefined : s.sellCall };
    });
    if (made) console.log(`[real] ${(made as Fill).note}`);
  }
  // A sale changed what the wallets hold.
  await reconcile();
}

/**
 * Looks over the desk's positions and sells what has made or lost enough. Safe to call often,
 * and from anywhere: a call made while one is running joins it.
 */
export function realRisk(force = false): Promise<void> {
  if (!realTrading()) return Promise.resolve();
  const m = memo();
  if (m.checking) return m.checking;
  if (!force && Date.now() - m.last < MIN_GAP_MS) return Promise.resolve();
  m.last = Date.now();
  m.checking = inRealTurn(look)
    .catch((e) => console.error("[real] could not look over the positions:", said(e)))
    .finally(() => {
      m.checking = null;
    });
  return m.checking;
}
