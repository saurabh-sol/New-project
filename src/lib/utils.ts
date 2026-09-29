import clsx, { type ClassValue } from "clsx";
import { priceDecimals } from "./market";

export const cn = (...v: ClassValue[]) => clsx(v);

/** "#10b981" + 0.4 -> "#10b98166" */
export const withAlpha = (hex: string, a: number) =>
  `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, "0")}`;

/** "+$1.20" / "−$0.35". Amounts that round to zero read "$0.00", never "−$0.00". */
export function fmtSigned(n: number, digits = 2) {
  const shown = Math.abs(n).toFixed(digits);
  if (Number(shown) === 0) return `$${shown}`;
  return `${n > 0 ? "+" : "−"}$${shown}`;
}

/** Smallest PnL range a sparkline spans, in USDG, so cent-sized noise draws as a flat line. */
export const MIN_SPARK_SPAN = 2;

export const fmtPrice = (p: number) => p.toFixed(priceDecimals(p));

export const shortHash = (h: string) => `${h.slice(0, 5)}…${h.slice(-5)}`;

/** A wallet address cut down to its first and last characters. */
export const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;
