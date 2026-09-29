"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  fetchCandles,
  fetchServerCandles,
  INTERVAL_SECONDS,
  INTERVALS,
  isCrypto,
  isToken,
  priceDecimals,
  SESSION_LABEL,
  subscribeCandles,
  TOKENS,
  type AssetKey,
  type Candle,
  type Interval,
} from "@/lib/market";
import { cn } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { useMarket } from "@/store/market";

const UP = "#22c55e";
const DOWN = "#ef4444";

interface ChartApi {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time>;
}

/** The chart library plots UTC; shift so the axis reads in the viewer's local time. */
const toChartTime = (unixSeconds: number) => (unixSeconds - new Date().getTimezoneOffset() * 60) as UTCTimestamp;

/** How often the chart of a token that has no live stream asks for new candles. */
const REFRESH_MS = 30_000;

const candleBar = (c: Candle) => ({ time: toChartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close });
const volumeBar = (c: Candle) => ({ time: toChartTime(c.time), value: c.volume, color: c.close >= c.open ? `${UP}55` : `${DOWN}55` });

export function PriceChart() {
  const councilToken = useArena((s) => s.focus);
  const fills = useArena((s) => s.fills);
  const held = useArena((s) => s.portfolio.positions);
  const assets = useArena((s) => s.assets);
  const [pinned, setPinned] = useState<AssetKey | null>(null);
  const [interval, setChartInterval] = useState<Interval>("1m");
  const token: AssetKey = pinned ?? councilToken ?? TOKENS[0];
  const crypto = isCrypto(token);
  // Tokens funders asked for get a tab while the desk holds them or is debating them.
  const extra = [...new Set([...held.map((p) => p.token), councilToken ?? "", pinned ?? ""])].filter((t) => t && !isToken(t));
  const key = `${token}:${interval}`;
  const quote = useMarket((s) => s.quotes[token]);

  // Which token/interval the chart currently shows, or failed to load.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const status = loaded === key ? "live" : failed === key ? "error" : "loading";

  const boxRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ChartApi | null>(null);

  useEffect(() => {
    if (!boxRef.current) return;
    const chart = createChart(boxRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#8b95a7",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: { vertLines: { color: "#ffffff0a" }, horzLines: { color: "#ffffff0a" } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: "#ffffff14" },
      timeScale: { borderColor: "#ffffff14", timeVisible: true, secondsVisible: false, rightOffset: 6 },
    });
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      wickUpColor: UP,
      wickDownColor: DOWN,
      borderVisible: false,
    });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "", lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    const api: ChartApi = { chart, candles, volume, markers: createSeriesMarkers(candles, []) };
    apiRef.current = api;
    return () => {
      apiRef.current = null;
      chart.remove();
    };
  }, []);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const ctrl = new AbortController();
    const alive = () => !ctrl.signal.aborted && apiRef.current === api;
    let unsubscribe = () => {};
    // Never leave another token's candles under this token's name.
    api.candles.setData([]);
    api.volume.setData([]);

    const draw = (rows: Candle[], reframe: boolean) => {
      const decimals = priceDecimals(rows[rows.length - 1].close);
      api.candles.applyOptions({ priceFormat: { type: "price", precision: decimals, minMove: 10 ** -decimals } });
      api.candles.setData(rows.map(candleBar));
      api.volume.setData(rows.map(volumeBar));
      if (reframe) api.chart.timeScale().setVisibleLogicalRange({ from: rows.length - 90, to: rows.length + 6 });
      setLoaded(`${token}:${interval}`);
    };

    if (isCrypto(token)) {
      fetchCandles(token, interval, 300, ctrl.signal)
        .then((rows) => {
          if (!alive() || rows.length === 0) return;
          draw(rows, true);
          unsubscribe = subscribeCandles(token, interval, (c) => {
            if (!alive()) return;
            api.candles.update(candleBar(c));
            api.volume.update(volumeBar(c));
            useMarket.getState().setPrice(token, c.close);
          });
        })
        .catch(() => {
          if (alive()) setFailed(`${token}:${interval}`);
        });
    } else {
      // Only crypto has a live stream to subscribe to. Everything else is fetched again every so often.
      let first = true;
      const load = () =>
        fetchServerCandles(token, interval, ctrl.signal)
          .then((rows) => {
            if (!alive() || rows.length === 0) return;
            draw(rows, first);
            first = false;
            useMarket.getState().setPrice(token, rows[rows.length - 1].close);
          })
          .catch(() => {
            if (alive() && first) setFailed(`${token}:${interval}`);
          });
      void load();
      const timer = setInterval(load, REFRESH_MS);
      unsubscribe = () => clearInterval(timer);
    }

    return () => {
      ctrl.abort();
      unsubscribe();
    };
  }, [token, interval]);

  // Council trades as arrows on the candle where they happened.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const step = INTERVAL_SECONDS[interval];
    const marks: SeriesMarker<Time>[] = fills
      .filter((f) => f.token === token)
      .map((f) => ({
        time: toChartTime(Math.floor(f.ts / 1000 / step) * step),
        position: f.side === "BUY" ? ("belowBar" as const) : ("aboveBar" as const),
        shape: f.side === "BUY" ? ("arrowUp" as const) : ("arrowDown" as const),
        color: f.side === "BUY" ? UP : DOWN,
        text: `${f.reason === "COUNCIL" ? f.side : f.reason} $${f.usd.toFixed(0)}`,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    api.markers.setMarkers(loaded === `${token}:${interval}` ? marks : []);
  }, [fills, token, interval, loaded]);

  const decimals = quote ? priceDecimals(quote.price) : 2;
  const source = crypto ? "Live prices · Binance spot" : isToken(token) || assets[token]?.kind === "stock" ? "Robinhood Stock Token · history from Yahoo Finance" : "Pool prices · GeckoTerminal";

  return (
    <section className="flex min-w-0 flex-col panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/5 px-4 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-white">
            {token}
            <span className="text-white/35">{crypto ? "/USDT" : "/USD"}</span>
          </h2>
          {quote && (
            <>
              <span className="font-mono text-base font-semibold tabular-nums text-white">${quote.price.toFixed(decimals)}</span>
              <span className={cn("font-mono text-xs tabular-nums", quote.change24h >= 0 ? "text-green-400" : "text-red-400")}>
                {quote.change24h >= 0 ? "▲" : "▼"} {Math.abs(quote.change24h).toFixed(2)}% {crypto ? "24h" : "today"}
              </span>
              {quote.session && <span className="rounded-full border border-white/15 px-2 py-px text-[10px] uppercase tracking-wider text-white/50">{SESSION_LABEL[quote.session]}</span>}
            </>
          )}
        </div>

        <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          <Tab active={pinned === null} onClick={() => setPinned(null)} title="Show whichever token the council is debating">
            <span className={cn("mr-1 inline-block size-1.5 rounded-full", pinned === null ? "animate-pulse bg-white" : "bg-white/30")} />
            Follow council
          </Tab>
          {[...TOKENS, ...extra].map((t) => (
            <Tab key={t} active={pinned === t} onClick={() => setPinned(t)} title={isToken(t) ? undefined : "Asked for by a funder"}>
              {t}
            </Tab>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          {INTERVALS.map((i) => (
            <Tab key={i} active={interval === i} onClick={() => setChartInterval(i)}>
              {i}
            </Tab>
          ))}
        </div>
      </div>

      <div className="relative min-h-[340px] flex-1">
        <div ref={boxRef} className="absolute inset-0" />
        {status !== "live" && (
          <div className="absolute inset-0 grid place-items-center bg-[#07090d]/70 text-sm text-white/50 backdrop-blur-sm">
            {status === "loading" ? (
              <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.4, repeat: Infinity }}>
                Loading {token} candles…
              </motion.span>
            ) : (
              <span className="max-w-xs text-center">
                Can&apos;t reach the market data feed right now. The chart will not show made-up prices; check your connection and reload.
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 px-4 py-2 text-[11px] text-white/40">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", status === "live" ? "animate-pulse bg-white" : "bg-white/30")} />
          {status !== "live" ? "Offline" : source}
        </span>
        <span>Arrows mark the council&apos;s paper trades</span>
      </div>
    </section>
  );
}

function Tab({ active, onClick, title, children }: { active: boolean; onClick: () => void; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "flex shrink-0 items-center whitespace-nowrap rounded-lg px-2.5 py-1 font-mono text-[11px] transition-colors",
        active ? "bg-white/20 text-white ring-1 ring-white/50" : "text-white/45 hover:bg-white/5 hover:text-white/80",
      )}
    >
      {children}
    </button>
  );
}
