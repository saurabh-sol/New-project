"use client";

import { motion } from "motion/react";
import { priceDecimals, TOKENS } from "@/lib/market";
import { cn } from "@/lib/utils";
import { useMarket } from "@/store/market";

// Skyline seen through the windows: [x, width, height] of each tower, in window units (0..400 wide, 170 tall).
const TOWERS = [
  [0, 46, 92],
  [44, 38, 126],
  [80, 54, 74],
  [132, 34, 142],
  [164, 50, 104],
  [212, 40, 60],
  [250, 44, 132],
  [292, 52, 88],
  [342, 58, 112],
] as const;

function Window({ x, flip = false }: { x: number; flip?: boolean }) {
  return (
    <g transform={`translate(${x} 30)`}>
      <rect width="400" height="170" fill="url(#night)" />
      <circle cx={flip ? 70 : 330} cy="38" r="15" fill="#fef3c7" opacity="0.9" />
      <g transform={flip ? "translate(400 0) scale(-1 1)" : undefined}>
        {TOWERS.map(([tx, w, h], i) => (
          <g key={tx}>
            <rect x={tx} y={170 - h} width={w} height={h} fill={i % 2 ? "#0c1222" : "#101831"} />
            {/* lit office windows */}
            {Array.from({ length: Math.floor(h / 16) }, (_, row) =>
              Array.from({ length: Math.floor(w / 12) }, (_, col) =>
                (row * 7 + col * 3 + i * 5) % 4 === 0 ? (
                  <rect key={`${row}-${col}`} x={tx + 5 + col * 12} y={170 - h + 7 + row * 16} width="5" height="7" fill="#fcd34d" opacity="0.75" />
                ) : null,
              ),
            )}
          </g>
        ))}
      </g>
      {/* frame and mullions */}
      <rect width="400" height="170" fill="none" stroke="#55627d" strokeWidth="9" />
      <path d="M133 0 V170 M267 0 V170 M0 96 H400" stroke="#55627d" strokeWidth="5" />
      {/* sill */}
      <rect x="-12" y="170" width="424" height="11" rx="3" fill="#66748f" />
    </g>
  );
}

/** Back wall, windows and wood floor. Stretches with the arena. */
function Room() {
  return (
    <svg viewBox="0 0 1600 1100" preserveAspectRatio="none" className="absolute inset-0 size-full">
      <defs>
        <linearGradient id="wall" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2b3449" />
          <stop offset="1" stopColor="#3a4560" />
        </linearGradient>
        <linearGradient id="night" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#0a1230" />
          <stop offset="1" stopColor="#25366b" />
        </linearGradient>
        {/* long, narrow boards with quiet seams, so the floor reads as wood and not brick */}
        <pattern id="planks" width="760" height="78" patternUnits="userSpaceOnUse">
          <rect width="760" height="78" fill="#6a4b32" />
          <rect x="300" width="460" height="39" fill="#6f4f35" />
          <rect y="39" width="520" height="39" fill="#664830" />
          <path d="M0 0 H760 M0 39 H760" stroke="#4a3322" strokeWidth="1.4" opacity="0.75" />
          <path d="M300 0 V39 M520 39 V78" stroke="#4a3322" strokeWidth="1.2" opacity="0.6" />
        </pattern>
        <linearGradient id="depth" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.55" />
          <stop offset="0.18" stopColor="#000" stopOpacity="0.12" />
          <stop offset="0.75" stopColor="#000" stopOpacity="0.1" />
          <stop offset="1" stopColor="#000" stopOpacity="0.45" />
        </linearGradient>
        <radialGradient id="lamp">
          <stop offset="0" stopColor="#ffe9bd" stopOpacity="0.34" />
          <stop offset="1" stopColor="#ffe9bd" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="rug">
          <stop offset="0" stopColor="#274b78" />
          <stop offset="1" stopColor="#1a3253" />
        </radialGradient>
      </defs>

      {/* floor */}
      <rect y="242" width="1600" height="858" fill="url(#planks)" />
      <rect y="242" width="1600" height="858" fill="url(#depth)" />

      {/* rug under the council table */}
      <ellipse cx="800" cy="790" rx="360" ry="158" fill="#0d1726" opacity="0.45" />
      <ellipse cx="800" cy="782" rx="352" ry="152" fill="url(#rug)" />
      <ellipse cx="800" cy="782" rx="322" ry="134" fill="none" stroke="#d4a64f" strokeWidth="4" strokeDasharray="16 12" opacity="0.7" />
      <ellipse cx="800" cy="782" rx="352" ry="152" fill="none" stroke="#11233d" strokeWidth="6" />

      {/* pools of light from the ceiling lamps */}
      {[
        [270, 450],
        [1330, 450],
        [270, 990],
        [1330, 990],
        [800, 760],
      ].map(([cx, cy]) => (
        <ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx="330" ry="170" fill="url(#lamp)" />
      ))}

      {/* wall */}
      <rect width="1600" height="242" fill="url(#wall)" />
      <path d="M520 0 V228 M1080 0 V228" stroke="#222a3c" strokeWidth="3" opacity="0.6" />
      <Window x={70} />
      <Window x={1130} flip />
      {/* market board housing */}
      <rect x="548" y="18" width="504" height="186" rx="10" fill="#0a0d14" stroke="#55627d" strokeWidth="6" />
      {/* baseboard */}
      <rect y="226" width="1600" height="16" fill="#1c2333" />
      <rect y="240" width="1600" height="3" fill="#000" opacity="0.5" />
    </svg>
  );
}

/** Live quotes on the wall screen. */
function MarketBoard() {
  const quotes = useMarket((s) => s.quotes);
  const status = useMarket((s) => s.status);

  return (
    <div className="absolute left-[35.2%] top-[2.6%] flex h-[15%] w-[29.6%] flex-col overflow-hidden px-[1.2%] py-[0.6%] font-mono">
      <div className="flex items-center justify-between text-[clamp(5px,0.85cqw,9px)] tracking-[0.25em] text-white/45">
        <span>MARKETS</span>
        <span className="flex items-center gap-1">
          <span className={cn("size-[0.5em] rounded-full", status === "live" ? "animate-pulse bg-green-400" : "bg-white/30")} />
          {status === "live" ? "LIVE" : "OFFLINE"}
        </span>
      </div>
      <div className="grid flex-1 grid-cols-3 content-center gap-x-[4%] gap-y-[6%] text-[clamp(5px,1cqw,11px)] leading-none">
        {TOKENS.map((t) => {
          const q = quotes[t];
          return (
            <div key={t} className="flex flex-col gap-[0.25em]">
              <span className="font-semibold text-white">{t}</span>
              <span className="text-white/55">{q ? `$${q.price.toFixed(priceDecimals(q.price))}` : "…"}</span>
              {q && (
                <span className={q.change24h >= 0 ? "text-green-400" : "text-red-400"}>
                  {q.change24h >= 0 ? "▲" : "▼"} {Math.abs(q.change24h).toFixed(1)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const Plant = () => (
  <svg viewBox="0 0 60 92" className="block w-full overflow-visible">
    <ellipse cx="30" cy="89" rx="20" ry="3.5" fill="#000" opacity="0.4" />
    <g fill="#2d8a52">
      <ellipse cx="30" cy="30" rx="7" ry="27" />
      <ellipse cx="30" cy="38" rx="7" ry="24" transform="rotate(-38 30 60)" />
      <ellipse cx="30" cy="38" rx="7" ry="24" transform="rotate(38 30 60)" />
    </g>
    <g fill="#3fae6c">
      <ellipse cx="30" cy="40" rx="5.5" ry="20" transform="rotate(-18 30 60)" />
      <ellipse cx="30" cy="40" rx="5.5" ry="20" transform="rotate(18 30 60)" />
    </g>
    <path d="M17 62 H43 L40 88 H20 Z" fill="#b5623b" />
    <rect x="15" y="58" width="30" height="7" rx="2.5" fill="#cf7b52" />
  </svg>
);

const WaterCooler = () => (
  <svg viewBox="0 0 40 92" className="block w-full overflow-visible">
    <ellipse cx="20" cy="89" rx="17" ry="3.5" fill="#000" opacity="0.4" />
    <rect x="9" y="1" width="22" height="31" rx="9" fill="#7dd3fc" opacity="0.75" />
    <rect x="12" y="6" width="5" height="18" rx="2.5" fill="#fff" opacity="0.5" />
    <rect x="6" y="31" width="28" height="56" rx="3" fill="#dfe5ee" />
    <rect x="6" y="31" width="28" height="6" rx="3" fill="#b8c2d1" />
    <rect x="12" y="44" width="5" height="7" rx="1" fill="#3b82f6" />
    <rect x="23" y="44" width="5" height="7" rx="1" fill="#ef4444" />
    <rect x="10" y="54" width="20" height="9" rx="1.5" fill="#9aa6b8" />
  </svg>
);

const Cabinet = () => (
  <svg viewBox="0 0 170 84" className="block w-full overflow-visible">
    <ellipse cx="85" cy="81" rx="84" ry="4" fill="#000" opacity="0.4" />
    {/* things kept on top */}
    <rect x="12" y="4" width="26" height="28" rx="3" fill="#1f2937" />
    <rect x="16" y="9" width="18" height="9" rx="1.5" fill="#0b0f16" />
    <circle cx="33" cy="25" r="1.8" fill="#ef4444" />
    <rect x="47" y="21" width="9" height="11" rx="1.5" fill="#f8fafc" />
    <g>
      <rect x="98" y="8" width="8" height="24" fill="#ef4444" />
      <rect x="106" y="12" width="7" height="20" fill="#3b82f6" />
      <rect x="113" y="6" width="9" height="26" fill="#f59e0b" />
      <rect x="122" y="14" width="7" height="18" fill="#10b981" />
      <rect x="133" y="25" width="26" height="7" rx="1" fill="#e2e8f0" />
      <rect x="136" y="19" width="20" height="6" rx="1" fill="#cbd5e1" />
    </g>
    {/* body */}
    <rect x="2" y="32" width="166" height="48" rx="3" fill="#6d4e35" />
    <rect x="2" y="32" width="166" height="7" rx="3" fill="#8a6646" />
    <path d="M57 39 V80 M113 39 V80" stroke="#3c2a1b" strokeWidth="2" />
    <g fill="#d4a64f">
      <rect x="47" y="56" width="5" height="9" rx="2" />
      <rect x="63" y="56" width="5" height="9" rx="2" />
      <rect x="103" y="56" width="5" height="9" rx="2" />
      <rect x="119" y="56" width="5" height="9" rx="2" />
    </g>
  </svg>
);

const FloorLamp = () => (
  <svg viewBox="0 0 50 124" className="block w-full overflow-visible">
    <ellipse cx="25" cy="121" rx="15" ry="3" fill="#000" opacity="0.4" />
    <motion.ellipse cx="25" cy="18" rx="30" ry="24" fill="#ffe9bd" animate={{ opacity: [0.2, 0.3, 0.2] }} transition={{ duration: 4, repeat: Infinity }} />
    <rect x="23.5" y="30" width="3" height="88" fill="#1f2937" />
    <rect x="13" y="116" width="24" height="5" rx="2.5" fill="#1f2937" />
    <path d="M12 4 H38 L44 32 H6 Z" fill="#fde7b0" />
    <path d="M12 4 H38 L39.5 11 H10.5 Z" fill="#fff5d6" />
  </svg>
);

interface PropSpot {
  x: number;
  /** Where the prop touches the floor, which also sets what it stands in front of. */
  y: number;
  /** Width in % of the arena's width. */
  w: number;
  art: React.ReactNode;
}

const PROPS: PropSpot[] = [
  { x: 37, y: 31, w: 4, art: <WaterCooler /> },
  { x: 50, y: 30.5, w: 15, art: <Cabinet /> },
  { x: 63, y: 31, w: 4.4, art: <FloorLamp /> },
  { x: 3.6, y: 68, w: 6, art: <Plant /> },
  { x: 96.4, y: 68, w: 6, art: <Plant /> },
];

/** The office the council works in. */
export function Scene() {
  return (
    <>
      <Room />
      <MarketBoard />
      {PROPS.map((p) => (
        <div
          key={`${p.x}-${p.y}`}
          className="absolute -translate-x-1/2 -translate-y-full"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: `${p.w}cqw`, zIndex: Math.round(p.y * 10) }}
        >
          {p.art}
        </div>
      ))}
    </>
  );
}
