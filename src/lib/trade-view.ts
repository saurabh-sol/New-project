"use client";

import { useSyncExternalStore } from "react";
import type { Fill } from "./council";

/** gains: only the sales that booked a gain. all: every order, purchases and losing sales included. */
export type TradeView = "gains" | "all";

/** Where the visitor's choice is kept. */
const VIEW_KEY = "council:trades";
/** What a visitor who has not chosen sees. The lists say which view they are in, and how many trades it leaves out. */
const FIRST_VIEW: TradeView = "gains";

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

let view: TradeView | null = null;

function currentView(): TradeView {
  if (view) return view;
  try {
    const kept = localStorage.getItem(VIEW_KEY);
    view = kept === "gains" || kept === "all" ? kept : FIRST_VIEW;
  } catch {
    view = FIRST_VIEW;
  }
  return view;
}

/** Shows the trade lists in this view, and remembers it for the next visit. */
export function setTradeView(next: TradeView) {
  view = next;
  try {
    localStorage.setItem(VIEW_KEY, next);
  } catch {
    // Private browsing: the choice lasts for this visit.
  }
  listeners.forEach((fn) => fn());
}

/** The view both trade lists are in. */
export const useTradeView = (): TradeView => useSyncExternalStore(subscribe, currentView, () => FIRST_VIEW);

/** A sale that booked a gain. A purchase books nothing, so it is not one. */
export const gained = (f: Fill) => f.realized !== null && f.realized >= 0.005;

export interface Tally {
  /** Every order on the page. */
  orders: number;
  /** Sales: the trades with a result. */
  closed: number;
  gains: number;
  losses: number;
}

/** How the orders on the page came out, so a list that shows only the gains can say what it leaves out. */
export function tally(fills: Fill[]): Tally {
  const closed = fills.filter((f) => f.realized !== null);
  const gains = closed.filter(gained).length;
  const losses = closed.filter((f) => (f.realized ?? 0) <= -0.005).length;
  return { orders: fills.length, closed: closed.length, gains, losses };
}

/** The orders a view shows. */
export const inView = (fills: Fill[], v: TradeView) => (v === "gains" ? fills.filter(gained) : fills);
