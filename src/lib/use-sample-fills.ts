"use client";

import { useSyncExternalStore } from "react";
import type { Fill } from "./council";
import { sampleFills } from "./showcase";

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
