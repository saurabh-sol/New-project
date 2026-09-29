"use client";

import { useSyncExternalStore } from "react";

import { THEME_COLOR, THEME_KEY, type Theme } from "./theme-keys";

export type { Theme };

const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const currentTheme = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

export function storedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

/** Shows the page in this theme. `keep` remembers it for the next visit. */
export function applyTheme(theme: Theme, keep = true) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  if (keep) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Private browsing: the choice lasts for this visit.
    }
  }
  listeners.forEach((fn) => fn());
}

/** The theme on screen. The server renders dark, and a visitor who chose light is switched before the first paint. */
export const useTheme = (): Theme => useSyncExternalStore(subscribe, currentTheme, () => "dark");
