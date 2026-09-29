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
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useArena } from "@/store/arena";
import { useMarket } from "@/store/market";
import { useWatched } from "@/store/selectors";

const UP = "#22c55e";
const DOWN = "#ef4444";

/** The chart is drawn on a canvas, which the page's styles don't reach. */
const chartColors = (theme: Theme) => {
  const ink = theme === "light" ? "#000000" : "#ffffff";
  return {
    layout: { textColor: theme === "light" ? "#52525b" : "#8b95a7" },
    grid: { vertLines: { color: `${ink}0d` }, horzLines: { color: `${ink}0d` } },
    rightPriceScale: { borderColor: `${ink}1a` },
    timeScale: { borderColor: `${ink}1a` },
  };
};

interface ChartApi {
  chart: IChartApi;
  candles: ISeriesApi<"Candlestick">;
  volume: ISeriesApi<"Histogram">;
  markers: ISeriesMarkersPluginApi<Time>;
}

/** The chart library plots UTC; shift so the axis reads in the viewer's local time. */
const toChartTime = (unixSeconds: number) => (unixSeconds - new Date().getTimezoneOffset() * 60) as UTCTimestamp;

/** How often the chart of a token that has no live stream asks for new candles. */
// The live price moves the latest candle in between, so the candles themselves need not be asked for often.
const REFRESH_MS = 60_000;

const candleBar = (c: Candle) => ({ time: toChartTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close });
const volumeBar = (c: Candle) => ({ time: toChartTime(c.time), value: c.volume, color: c.close >= c.open ? `${UP}55` : `${DOWN}55` });

export function PriceChart({ className }: { className?: string }) {
  const councilToken = useArena((s) => s.focus);
  const fills = useArena((s) => s.fills);
  const held = useArena((s) => s.portfolio.positions);
  const assets = useArena((s) => s.assets);
  const [pinned, setPinned] = useState<AssetKey | null>(null);
  const [interval, setChartInterval] = useState<Interval>("1m");
  const watched = useWatched();
  const token: AssetKey = pinned ?? councilToken ?? watched[0] ?? TOKENS[0];
  const crypto = isCrypto(token);
  // Every token on the board has a tab, and so has whatever the desk holds or is debating.
  const tabs = [...new Set([...watched, ...held.map((p) => p.token), councilToken ?? "", pinned ?? ""])].filter(Boolean);
  const lastRef = useRef<Candle | null>(null);
  const key = `${token}:${interval}`;
  const quote = useMarket((s) => s.quotes[token]);

  // Which token/interval the chart currently shows, or failed to load.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const status = loaded === key ? "live" : failed === key ? "error" : "loading";

  const boxRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<ChartApi | null>(null);
  const theme = useTheme();

  useEffect(() => {
    if (!boxRef.current) return;
    const chart = createChart(boxRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
        attributionLogo: true,
      },
      crosshair: { mode: CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 6 },
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
    apiRef.current?.chart.applyOptions(chartColors(theme));
  }, [theme]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const ctrl = new AbortController();
    const alive = () => !ctrl.signal.aborted && apiRef.current === api;
    let unsubscribe = () => {};
    // Never leave another token's candles under this token's name.
    api.candles.setData([]);
    api.volume.setData([]);

    lastRef.current = null;
    const draw = (rows: Candle[], reframe: boolean) => {
      lastRef.current = rows[rows.length - 1];
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
            // A Stock Token's latest candle is its price. A pool token has a live quote, which is newer than its candles.
            if (isToken(token) || assets[token]?.kind === "stock") useMarket.getState().setPrice(token, rows[rows.length - 1].close);
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
    // `assets` is read when the candles arrive. A change in it is no reason to load them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, interval]);

  // Between loads of the candles, the live price moves the latest one.
  const livePrice = quote?.price;
  useEffect(() => {
    const api = apiRef.current;
    const last = lastRef.current;
    if (!api || !last || !livePrice || crypto || loaded !== `${token}:${interval}`) return;
    const step = INTERVAL_SECONDS[interval];
    const slot = Math.floor(Date.now() / 1000 / step) * step;
    // A new stretch of time opens a new candle, at the price the last one closed at.
    const next: Candle = slot > last.time ? { time: slot, open: last.close, high: Math.max(last.close, livePrice), low: Math.min(last.close, livePrice), close: livePrice, volume: 0 } : { ...last, close: livePrice, high: Math.max(last.high, livePrice), low: Math.min(last.low, livePrice) };
    lastRef.current = next;
    api.candles.update(candleBar(next));
  }, [livePrice, token, interval, crypto, loaded]);

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
        text: `${f.reason === "STOP" || f.reason === "TARGET" ? f.reason : f.reason === "FALLING" ? "FALL" : f.side} $${f.usd.toFixed(0)}`,
      }))
      .sort((a, b) => (a.time as number) - (b.time as number));
    api.markers.setMarkers(loaded === `${token}:${interval}` ? marks : []);
  }, [fills, token, interval, loaded]);

  const decimals = quote ? priceDecimals(quote.price) : 2;
  const source = crypto ? "Live prices · Binance spot" : isToken(token) || assets[token]?.kind === "stock" ? "Robinhood Stock Token · history from Yahoo Finance" : `${assets[token]?.launchpad === "pons" ? "Launched on Pons · " : ""}Live price · DexScreener · candles from the pool's swaps on-chain`;

  return (
    <section className={cn("panel flex min-w-0 flex-col", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/5 px-4 py-3 xl:gap-y-1 xl:px-3 xl:py-2">
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-white">
            {token}
            <span className="text-white/35">{crypto ? "/USDT" : "/USD"}</span>
          </h2>
          {quote && (
            <>
              <span className="font-mono text-base font-semibold tabular-nums text-white">${quote.price.toFixed(decimals)}</span>
              <span className={cn("font-mono text-xs tabular-nums", quote.change24h >= 0 ? "text-green-400" : "text-red-400")}>
                {quote.change24h >= 0 ? "▲" : "▼"} {Math.abs(quote.change24h).toFixed(2)}% {isToken(token) && !crypto ? "today" : assets[token]?.kind === "stock" ? "today" : "24h"}
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
          {tabs.map((t) => (
            <Tab key={t} active={pinned === t} onClick={() => setPinned(t)} title={assets[t]?.name}>
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

      <div className="relative min-h-[340px] flex-1 xl:min-h-0">
        <div ref={boxRef} className="absolute inset-0" />
        {status !== "live" && (
          <div className="absolute inset-0 grid place-items-center bg-black/70 text-sm text-white/50 backdrop-blur-sm">
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/5 px-4 py-2 text-[11px] text-white/40 xl:px-3 xl:py-1.5">
        <span className="flex items-center gap-1.5">
          <span className={cn("size-1.5 rounded-full", status === "live" ? "animate-pulse bg-white" : "bg-white/30")} />
          {status !== "live" ? "Offline" : source}
        </span>
        <span>Arrows mark the agents&apos; trades</span>
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
