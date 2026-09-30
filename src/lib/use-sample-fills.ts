"use client";

import { useSyncExternalStore } from "react";
import { leaderFirst } from "./agents";
import type { Fill } from "./council";
import { bookHashes, sampleFills } from "./showcase";
import type { AgentId } from "./types";

let samples: Fill[] | null = null;
const NO_SAMPLES: Fill[] = [];
const never = () => () => {};

/**
 * The sample trades of the demo book, timed from when the page opened. The server renders none, so the
 * page is the same on the server and in the browser; they come in right after, and stay the same for the visit.
 */
export const useSampleFills = (): Fill[] => useSyncExternalStore(never, () => (samples ??= sampleFills(Date.now())), () => NO_SAMPLES);

/** A sample trade, as against one of the desk's own. */
export const isSample = (f: Fill) => f.id.startsWith("sample-");

/** The sample trades and the desk's own in one list, newest first. */
export const withSamples = (samples: Fill[], own: Fill[]) => [...samples, ...own].sort((a, b) => b.ts - a.ts);

/**
 * The hash of each agent's part of a trade, the leader's first. A trade recorded on the agents' contracts
 * has them from the chain; a sample trade, or one of the desk's own with no contracts to record it on, has
 * them from its id (src/lib/showcase.ts). Every trade in the lists gets one for each agent in it.
 */
export function hashesOf(f: Fill): Array<{ agent: AgentId; hash: string }> {
  const agents = leaderFirst(f.leader);
  const parties = agents.filter((a) => (f.stake[a] ?? 0) >= 0.01);
  const txs = f.txs && Object.keys(f.txs).length ? f.txs : f.tx ? { [f.leader]: f.tx } : bookHashes(f.id, parties.length ? parties : [f.leader]);
  return agents.flatMap((a) => (txs[a] ? [{ agent: a, hash: txs[a]! }] : []));
}
