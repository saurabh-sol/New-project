"use client";

import { motion, type TargetAndTransition } from "motion/react";
import { AGENTS } from "@/lib/agents";
import type { Emotion } from "@/lib/council";
import type { AgentId } from "@/lib/types";

export type Pose = "idle" | "walk" | "carry" | "type" | "exec" | "talk" | "vote" | "cheer" | "slump";

interface Rig {
  body: TargetAndTransition;
  head: TargetAndTransition;
  armL: TargetAndTransition;
  armR: TargetAndTransition;
  legL: TargetAndTransition;
  legR: TargetAndTransition;
}

const loop = (duration: number, delay = 0) => ({ duration, delay, repeat: Infinity, ease: "easeInOut" as const });
const settle = { duration: 0.25 };
/** A repeating movement in which some values only have to get into place, once. */
const settling = (repeating: object, ...once: Array<"x" | "y" | "rotate">) => ({ ...repeating, ...Object.fromEntries(once.map((k) => [k, settle])) });
const REST: TargetAndTransition = { rotate: 0, x: 0, y: 0, transition: settle };
const STILL: TargetAndTransition = { y: 0, rotate: 0, transition: settle };
const LEVEL: TargetAndTransition = { rotate: 0, y: 0, transition: settle };

/**
 * The walk. One cycle is two steps, in four beats: a foot leaves the ground behind the body,
 * passes under it lifted, lands ahead, and is carried back along the floor while the other
 * foot does the same. The character faces right here; the caller mirrors it to walk left.
 */
const STRIDE_SECONDS = 0.44;
const BEATS = [0, 0.25, 0.5, 0.75, 1];
const step = (ease: Array<"linear" | "easeIn" | "easeOut" | "easeInOut">) => ({ duration: STRIDE_SECONDS, times: BEATS, ease, repeat: Infinity });
// In the air a foot speeds up and slows down. On the ground it moves with the floor, at one speed.
const SWING_THEN_STANCE = step(["easeIn", "easeOut", "linear", "linear"]);
const STANCE_THEN_SWING = step(["linear", "linear", "easeIn", "easeOut"]);
const EVEN = step(["easeInOut", "easeInOut", "easeInOut", "easeInOut"]);
/** How far a leg swings either way, in degrees. A negative angle puts the foot ahead. */
const REACH = 22;
const LIFT = -6.5;
/** A walker is seen from the side: the legs move in under the body and swing from one hip line, and the arms move in with them. */
const LEGS_IN = 5.2;
const ARMS_IN = 3;

const WALK_LEGS = {
  legL: { rotate: [REACH, 0, -REACH, 0, REACH], x: LEGS_IN, y: [0, LIFT, 0, 0, 0], transition: settling(SWING_THEN_STANCE, "x") },
  legR: { rotate: [-REACH, 0, REACH, 0, -REACH], x: -LEGS_IN, y: [0, 0, 0, LIFT, 0], transition: settling(STANCE_THEN_SWING, "x") },
  // Highest as one leg passes under the body, lowest as a foot lands. It leans into the walk and rocks over the planted foot.
  body: { y: [0, -2.6, 0, -2.6, 0], rotate: [3.5, 5, 3.5, 2, 3.5], transition: EVEN },
  // The head stays level while the body leans.
  head: { rotate: [-3, -4, -3, -2, -3], y: [0, 0.8, 0, 0.8, 0], transition: EVEN },
};

const typing = (beat: number): Rig => ({
  body: { y: [0, -0.8, 0], rotate: 0, transition: settling(loop(beat * 2), "rotate") },
  head: { rotate: 0, y: 1.5, transition: settle },
  armL: { x: 0, rotate: [-30, -44, -30], transition: settling(loop(beat), "x") },
  armR: { x: 0, rotate: [30, 44, 30], transition: settling(loop(beat, beat / 2), "x") },
  legL: REST,
  legR: REST,
});

// Arms hang down at 0°. Positive rotation swings the left arm outward, negative the right arm.
const RIGS: Record<Pose, Rig> = {
  idle: {
    body: { y: [0, -1.2, 0], rotate: 0, transition: settling(loop(3), "rotate") },
    head: LEVEL,
    armL: REST,
    armR: REST,
    legL: REST,
    legR: REST,
  },
  walk: {
    ...WALK_LEGS,
    // Each arm swings against the leg on its side.
    armL: { rotate: [-18, 0, 18, 0, -18], x: ARMS_IN, transition: settling(EVEN, "x") },
    armR: { rotate: [18, 0, -18, 0, 18], x: -ARMS_IN, transition: settling(EVEN, "x") },
  },
  carry: {
    ...WALK_LEGS,
    armL: { x: 0, rotate: -30, transition: settle },
    armR: { x: 0, rotate: 30, transition: settle },
  },
  type: typing(0.24),
  exec: typing(0.12),
  talk: {
    body: { y: [0, -1.5, 0], rotate: 0, transition: settling(loop(0.5), "rotate") },
    head: { rotate: [-3, 3, -3], y: 0, transition: settling(loop(1), "y") },
    armL: REST,
    armR: { x: 0, rotate: [-25, -85, -40, -70, -25], transition: settling(loop(1.6), "x") },
    legL: REST,
    legR: REST,
  },
  vote: {
    body: STILL,
    head: LEVEL,
    armL: REST,
    armR: { x: 0, rotate: -155, transition: { type: "spring", stiffness: 260, damping: 14 } },
    legL: REST,
    legR: REST,
  },
  cheer: {
    body: { y: [0, -16, 0], rotate: 0, transition: settling({ duration: 0.5, repeat: Infinity, ease: "easeOut" }, "rotate") },
    head: LEVEL,
    armL: { x: 0, rotate: [140, 162, 140], transition: settling(loop(0.25), "x") },
    armR: { x: 0, rotate: [-140, -162, -140], transition: settling(loop(0.25), "x") },
    legL: { x: 0, rotate: [0, 14, 0], y: 0, transition: settling(loop(0.5), "x", "y") },
    legR: { x: 0, rotate: [0, -14, 0], y: 0, transition: settling(loop(0.5), "x", "y") },
  },
  slump: {
    body: { y: 3, rotate: 0, transition: { duration: 0.5 } },
    head: { rotate: 11, y: 3, transition: { duration: 0.5 } },
    armL: { x: 0, rotate: 5, transition: settle },
    armR: { x: 0, rotate: -5, transition: settle },
    legL: REST,
    legR: REST,
  },
};

const HIP = { originX: 0.5, originY: 0 };
const SHOULDER = { originX: 0.5, originY: 0 };
const NECK = { originX: 0.5, originY: 1 };
/** The body leans from the feet. */
const FEET = { originX: 0.5, originY: 1 };

/** How an emotion shows on the face and in the posture. */
interface Look {
  /** Eye openness; 1 is normal. */
  eyes: number;
  /** Brow tilt in degrees (positive = inner ends down, an angry look), and height. Null hides the brows. */
  brow: { tilt: number; y: number; liftRight?: number } | null;
  /** Mouth as one curve: start, control point, end. */
  mouth: [number, number, number, number, number, number];
  open?: boolean;
  headTilt: number;
  headDrop: number;
  /** Colour washed over the face screen. */
  tint: string | null;
  tremble: boolean;
}

const LOOKS: Record<Emotion, Look> = {
  neutral: { eyes: 1, brow: null, mouth: [36.4, 36.7, 40.5, 38.9, 44.6, 36.7], headTilt: 0, headDrop: 0, tint: null, tremble: false },
  confident: { eyes: 0.85, brow: { tilt: 9, y: 22 }, mouth: [36, 36.8, 41.5, 39.4, 45.5, 35.4], headTilt: -3, headDrop: -1, tint: null, tremble: false },
  excited: { eyes: 1.25, brow: { tilt: -7, y: 19.6 }, mouth: [35, 35, 40.5, 43, 46, 35], open: true, headTilt: 0, headDrop: -1.5, tint: "#fde047", tremble: false },
  happy: { eyes: 1, brow: { tilt: -5, y: 20.2 }, mouth: [35, 35.4, 40.5, 41.4, 46, 35.4], headTilt: 3, headDrop: 0, tint: "#4ade80", tremble: false },
  skeptical: { eyes: 0.7, brow: { tilt: 4, y: 23, liftRight: 3.6 }, mouth: [36.5, 38, 40.5, 37, 44.5, 35.8], headTilt: 7, headDrop: 0, tint: null, tremble: false },
  worried: { eyes: 1.15, brow: { tilt: -18, y: 21 }, mouth: [36.5, 38.4, 40.5, 35.8, 44.5, 38.4], headTilt: -2, headDrop: 1, tint: "#60a5fa", tremble: true },
  annoyed: { eyes: 0.6, brow: { tilt: 23, y: 23.4 }, mouth: [36.5, 38.6, 40.5, 35.4, 44.5, 38.6], headTilt: 0, headDrop: 0.5, tint: "#ef4444", tremble: true },
  sad: { eyes: 0.8, brow: { tilt: -25, y: 21.4 }, mouth: [35.5, 39.2, 40.5, 34.6, 45.5, 39.2], headTilt: 5, headDrop: 3, tint: "#60a5fa", tremble: false },
};

const mouthPath = ([x0, y0, cx, cy, x1, y1]: Look["mouth"]) => `M${x0} ${y0} Q${cx} ${cy} ${x1} ${y1}`;

/** Closed, smiling eyes, used for the happy face on every agent. */
const SmileEyes = ({ color }: { color: string }) => (
  <g fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round">
    <path d="M28 31 Q32 25 36 31" />
    <path d="M46 31 Q50 25 54 31" />
  </g>
);

/** A small light in the eye, which is what makes it look alive. */
const Glint = ({ x, y, r = 1.1 }: { x: number; y: number; r?: number }) => <circle cx={x} cy={y} r={r} fill="#fff" />;

const EYES_AT = [32, 50];

function Eyes({ id, color, smiling }: { id: AgentId; color: string; smiling: boolean }) {
  switch (id) {
    case "quant":
      return smiling ? (
        <SmileEyes color={color} />
      ) : (
        <>
          {EYES_AT.map((x) => (
            <g key={x}>
              <circle cx={x} cy="29" r="3.7" fill="#fff" />
              <circle cx={x + 0.5} cy="29.2" r="2" fill="#0b1020" />
              <Glint x={x + 1.3} y={28.3} r={0.8} />
            </g>
          ))}
        </>
      );
    case "degen":
      return (
        <>
          <rect x="23" y="24" width="35" height="9.5" rx="4.75" fill="url(#visor)" />
          {/* light moving over the visor */}
          <g clipPath="url(#visor-clip)">
            <motion.g animate={{ x: [-16, 40] }} transition={{ duration: 1.1, repeat: Infinity, repeatDelay: 3.4, ease: "easeInOut" }}>
              <path d="M30 22 L35 22 L30 36 L25 36 Z" fill="#fff" opacity="0.55" />
              <path d="M37.5 22 L39.5 22 L34.5 36 L32.5 36 Z" fill="#fff" opacity="0.35" />
            </motion.g>
          </g>
          <rect x="23" y="24" width="35" height="9.5" rx="4.75" fill="none" stroke="#e0f2fe" strokeOpacity="0.6" strokeWidth="0.7" />
          {smiling && <SmileEyes color="#0c4a6e" />}
        </>
      );
    case "guardian":
      return smiling ? (
        <SmileEyes color={color} />
      ) : (
        <>
          {EYES_AT.map((x) => (
            <g key={x}>
              <rect x={x - 2.9} y="24.6" width="5.8" height="8.8" rx="2.9" fill={color} />
              <Glint x={x + 0.9} y={26.9} />
              <circle cx={x - 0.9} cy="31" r="0.6" fill="#fff" opacity="0.8" />
            </g>
          ))}
        </>
      );
    case "oracle":
      return smiling ? (
        <SmileEyes color={color} />
      ) : (
        <>
          {EYES_AT.map((x) => (
            <g key={x}>
              <path d={`M${x} 23.6 L${x + 4.4} 29 L${x} 34.4 L${x - 4.4} 29 Z`} fill={color} />
              <path d={`M${x} 26.4 Q${x + 0.5} 28.5 ${x + 2.4} 29 Q${x + 0.5} 29.5 ${x} 31.6 Q${x - 0.5} 29.5 ${x - 2.4} 29 Q${x - 0.5} 28.5 ${x} 26.4 Z`} fill="#fff" />
            </g>
          ))}
        </>
      );
  }
}

/** Glasses sit outside the blinking eyes so they don't squash with them. */
const Glasses = () => (
  <g fill="none" stroke="#e2e8f0" strokeWidth="1">
    <rect x="26" y="23" width="12" height="12" rx="4.2" />
    <rect x="44" y="23" width="12" height="12" rx="4.2" />
    <path d="M38 28.2 q3 -1.6 6 0" />
  </g>
);

function Headgear({ id, color }: { id: AgentId; color: string }) {
  switch (id) {
    case "quant":
      return (
        <>
          <path d="M40 10 V3" stroke="#94a3b8" strokeWidth="1.6" />
          <motion.circle cx="40" cy="2.5" r="2.6" fill={color} animate={{ opacity: [1, 0.35, 1] }} transition={loop(1.6)} />
        </>
      );
    case "degen":
      return (
        <g fill={color}>
          <path d="M29 11.5 L32.5 1.5 L36 10.5 Z" />
          <path d="M36.5 10.5 L40 -1 L43.5 10.5 Z" />
          <path d="M44 10.5 L47.5 1.5 L51 11.5 Z" />
        </g>
      );
    case "guardian":
      return (
        <>
          <rect x="10.5" y="23" width="6" height="13" rx="3" fill={color} />
          <rect x="63.5" y="23" width="6" height="13" rx="3" fill={color} />
          <path d="M33 10.5 Q40 3 47 10.5 Z" fill={color} />
        </>
      );
    case "oracle":
      return (
        <>
          <motion.ellipse
            cx="40"
            cy="3"
            rx="14"
            ry="3.6"
            fill="none"
            stroke={color}
            strokeWidth="1.8"
            animate={{ y: [0, -2.5, 0], opacity: [0.9, 0.6, 0.9] }}
            transition={loop(2.4)}
          />
          <circle cx="40" cy="14.8" r="1.9" fill={color} />
        </>
      );
  }
}

function Chest({ id }: { id: AgentId }) {
  switch (id) {
    case "quant":
      return (
        <>
          <path d="M33 51 L40 58 L47 51" fill="none" stroke="#71717a" strokeWidth="2" strokeLinejoin="round" />
          <path d="M40 57 L43.2 61.5 L40 75 L36.8 61.5 Z" fill="#18181b" />
        </>
      );
    case "degen":
      return (
        <>
          <path d="M30 54 Q40 67 50 54" fill="none" stroke="#fbbf24" strokeWidth="1.8" />
          <circle cx="40" cy="62.5" r="3" fill="#fbbf24" />
        </>
      );
    case "guardian":
      return <path d="M40 56 L48.5 59 V66.5 Q48.5 73.5 40 77.5 Q31.5 73.5 31.5 66.5 V59 Z" fill="#fff7ed" opacity="0.92" />;
    case "oracle":
      return <path d="M40 56 Q41.6 64.4 50 66 Q41.6 67.6 40 76 Q38.4 67.6 30 66 Q38.4 64.4 40 56 Z" fill="#fff1f7" />;
  }
}

/** A touch of colour on the cheeks. */
const CHEEKS: Record<AgentId, string> = { quant: "#fda4af", degen: "#38bdf8", guardian: "#fb923c", oracle: "#f472b6" };

const STAR = "M0 -5 Q0.8 -0.8 5 0 Q0.8 0.8 0 5 Q-0.8 0.8 -5 0 Q-0.8 -0.8 0 -5 Z";

const CENTER = { originX: 0.5, originY: 0.5 };

/**
 * The small symbol that floats beside the head. `unflip` keeps glyphs readable when
 * the character faces left. Placement is on a plain group, because an animated
 * element's own transform would replace it.
 */
function Emote({ emotion, unflip }: { emotion: Emotion; unflip: number }) {
  const at = (x: number, y: number) => `translate(${x} ${y}) scale(${unflip} 1)`;
  switch (emotion) {
    case "annoyed":
      return (
        <g transform={at(69, 6)}>
          <motion.g fill="none" stroke="#ef4444" strokeWidth="2.2" strokeLinecap="round" animate={{ scale: [1, 1.25, 1] }} transition={loop(0.5)} style={CENTER}>
            <path d="M-5.5 -2 Q-2 -2 -2 -5.5" />
            <path d="M5.5 -2 Q2 -2 2 -5.5" />
            <path d="M-5.5 2 Q-2 2 -2 5.5" />
            <path d="M5.5 2 Q2 2 2 5.5" />
          </motion.g>
        </g>
      );
    case "worried":
      return (
        <g transform={at(66, 12)}>
          <motion.path
            d="M0 -5 C3 -1 4 2 0 4 C-4 2 -3 -1 0 -5 Z"
            fill="#7dd3fc"
            animate={{ y: [0, 9], opacity: [1, 1, 0] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "easeIn" }}
          />
        </g>
      );
    case "excited":
      return (
        <g fill="#fde047">
          <g transform={at(69, 4)}>
            <motion.path d={STAR} animate={{ scale: [0.4, 1.2, 0.4], rotate: [0, 45, 90] }} transition={loop(0.9)} style={CENTER} />
          </g>
          <g transform={at(10, 12)}>
            <motion.path d={STAR} animate={{ scale: [1, 0.4, 1] }} transition={loop(0.9, 0.3)} style={CENTER} />
          </g>
        </g>
      );
    case "happy":
      return (
        <g transform={at(69, 6)}>
          <motion.path d={STAR} fill="#4ade80" animate={{ scale: [0.6, 1.1, 0.6], opacity: [0.6, 1, 0.6] }} transition={loop(1.4)} style={CENTER} />
        </g>
      );
    case "skeptical":
      return (
        <g transform={at(69, 12)}>
          <motion.text
            textAnchor="middle"
            fontSize="17"
            fontWeight="700"
            fontFamily="var(--font-geist-sans), sans-serif"
            fill="#e2e8f0"
            animate={{ y: [0, -2, 0], rotate: [-8, 8, -8] }}
            transition={loop(1.8)}
            style={CENTER}
          >
            ?
          </motion.text>
        </g>
      );
    case "sad":
      return (
        <g transform={at(68, 3)}>
          <g fill="#64748b">
            <circle cx="-5" cy="1" r="4.5" />
            <circle cx="1" cy="-2" r="5.5" />
            <circle cx="7" cy="1" r="4" />
            <rect x="-9" y="1" width="20" height="4.5" rx="2.2" />
          </g>
          {[-4, 1.5, 7].map((x, i) => (
            <motion.path
              key={x}
              d={`M${x} 8 l-1.4 4`}
              stroke="#7dd3fc"
              strokeWidth="1.5"
              strokeLinecap="round"
              animate={{ y: [0, 5], opacity: [1, 0] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.22 }}
            />
          ))}
        </g>
      );
    default:
      return null;
  }
}

interface CharacterProps {
  id: AgentId;
  pose: Pose;
  emotion?: Emotion;
  thinking?: boolean;
  /** 1 facing right, -1 facing left. Only used to keep glyphs readable; the caller does the mirroring. */
  facing?: 1 | -1;
}

export function Character({ id, pose, emotion = "neutral", thinking = false, facing = 1 }: CharacterProps) {
  const a = AGENTS[id];
  const rig = RIGS[pose];
  const hand = a.head;
  const talking = pose === "talk";
  // Poses that carry their own feeling override the spoken emotion.
  const feeling: Emotion = pose === "cheer" ? "excited" : pose === "slump" ? "sad" : emotion;
  const look = LOOKS[feeling];
  const still = pose === "idle" || pose === "talk" || pose === "vote";
  const moving = pose === "walk" || pose === "carry";
  const striding = pose === "walk";
  const farArm = (
    <motion.g initial={false} animate={rig.armL} style={SHOULDER}>
      <rect x="13" y="53" width="9.5" height="28" rx="4.75" fill={a.bodyShade} />
      <circle cx="17.75" cy="82" r="5.2" fill={hand} />
    </motion.g>
  );

  return (
    <svg viewBox="0 0 80 124" className="block w-full overflow-visible">
      <defs>
        <linearGradient id={`body-${id}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={a.body} />
          <stop offset="1" stopColor={a.bodyShade} />
        </linearGradient>
        <linearGradient id={`head-${id}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor={a.head} />
          <stop offset="1" stopColor={a.headShade} />
        </linearGradient>
        {/* the face is a screen behind glass */}
        <linearGradient id="screen" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#16203a" />
          <stop offset="1" stopColor="#04060a" />
        </linearGradient>
        <clipPath id="screen-clip">
          <rect x="20.5" y="18" width="40" height="23.5" rx="10.5" />
        </clipPath>
        <linearGradient id="visor" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#bae6fd" />
          <stop offset="0.45" stopColor="#38bdf8" />
          <stop offset="1" stopColor="#0369a1" />
        </linearGradient>
        <clipPath id="visor-clip">
          <rect x="23" y="24" width="35" height="9.5" rx="4.75" />
        </clipPath>
      </defs>

      <motion.ellipse
        cx="40"
        cy="117"
        rx="23"
        ry="4.5"
        fill="#000"
        animate={moving ? { opacity: [0.4, 0.28, 0.4, 0.28, 0.4], scaleX: [1, 0.86, 1, 0.86, 1] } : { opacity: 0.4, scaleX: 1 }}
        transition={moving ? EVEN : settle}
        style={CENTER}
      />

      {/* nervous or angry energy shows as a tremble */}
      <motion.g
        animate={look.tremble && still ? { x: [0, -0.9, 0.9, -0.6, 0] } : { x: 0 }}
        transition={look.tremble && still ? { duration: 0.28, repeat: Infinity } : settle}
      >
        <motion.g animate={rig.body} style={FEET}>
          {/* A walker's far arm swings behind the body. Carrying, both hands hold the coin in front. */}
          {striding && farArm}

          {/* legs */}
          <motion.g animate={rig.legL} style={HIP}>
            <rect x="28" y="84" width="10" height="27" rx="4" fill={a.bodyShade} />
            <rect x="25.5" y="106" width="14.5" height="9" rx="4.5" fill={a.headShade} />
          </motion.g>
          <motion.g animate={rig.legR} style={HIP}>
            <rect x="42" y="84" width="10" height="27" rx="4" fill={a.bodyShade} />
            <rect x="40" y="106" width="14.5" height="9" rx="4.5" fill={a.headShade} />
          </motion.g>

          {/* torso */}
          <rect x="35" y="45" width="10" height="8" fill="#475569" />
          <rect x="22.5" y="50" width="35" height="39" rx="11" fill={`url(#body-${id})`} />
          <rect x="22.5" y="50" width="35" height="39" rx="11" fill="none" stroke={a.color} strokeOpacity="0.45" />
          <Chest id={id} />

          {/* capital being carried over to another desk */}
          {pose === "carry" && (
            <motion.g initial={{ scale: 0 }} animate={{ scale: 1 }} style={{ originX: 0.5, originY: 0.5 }}>
              <circle cx="40" cy="79" r="10.5" fill="#f59e0b" stroke="#fef3c7" strokeWidth="1.5" />
              <circle cx="40" cy="79" r="6.5" fill="none" stroke="#fef3c7" strokeWidth="1.3" opacity="0.8" />
              <circle cx="40" cy="79" r="2.4" fill="#fef3c7" />
            </motion.g>
          )}

          {/* arms */}
          {!striding && farArm}
          <motion.g animate={rig.armR} style={SHOULDER}>
            <rect x="57.5" y="53" width="9.5" height="28" rx="4.75" fill={a.bodyShade} />
            <circle cx="62.25" cy="82" r="5.2" fill={hand} />
          </motion.g>

          {/* head: the pose moves it, the emotion tilts it */}
          <motion.g animate={rig.head} style={NECK}>
            <motion.g animate={{ rotate: look.headTilt, y: look.headDrop }} transition={{ type: "spring", stiffness: 140, damping: 14 }} style={NECK}>
              <Headgear id={id} color={a.color} />
              {/* The Guardian wears headphones where the others have ears. */}
              {id !== "guardian" && (
                <g fill={a.color} opacity="0.9">
                  <rect x="12.4" y="24" width="5" height="10" rx="2.5" />
                  <rect x="62.6" y="24" width="5" height="10" rx="2.5" />
                </g>
              )}
              <rect x="16" y="10" width="48" height="37" rx="14" fill={`url(#head-${id})`} />
              <rect x="16" y="10" width="48" height="37" rx="14" fill="none" stroke={a.color} strokeOpacity="0.55" />
              <path d="M24 14.6 Q32 11.4 44 12.2" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
              {/* the face turns the way the character is walking */}
              <motion.g animate={{ x: moving ? 3.2 : 0 }} transition={settle}>
                <rect x="20.5" y="18" width="40" height="23.5" rx="10.5" fill="url(#screen)" />
                <g clipPath="url(#screen-clip)" fill="#fff">
                  <path d="M29 18 L36 18 L27 41.5 L20 41.5 Z" opacity="0.07" />
                  <path d="M38.5 18 L41 18 L32 41.5 L29.5 41.5 Z" opacity="0.05" />
                </g>
                <rect x="20.5" y="18" width="40" height="23.5" rx="10.5" fill="none" stroke={a.color} strokeOpacity="0.4" strokeWidth="0.8" />
                <g fill={CHEEKS[id]} opacity="0.5">
                  <ellipse cx="26.6" cy="35.6" rx="3" ry="1.7" />
                  <ellipse cx="54.4" cy="35.6" rx="3" ry="1.7" />
                </g>
                <motion.rect
                  x="20.5"
                  y="18"
                  width="40"
                  height="23.5"
                  rx="10.5"
                  animate={{ fill: look.tint ?? "#05070b", opacity: look.tint ? 0.22 : 0 }}
                  transition={{ duration: 0.4 }}
                />

                {/* brows */}
                <motion.g
                  stroke={feeling === "annoyed" ? "#fca5a5" : "#e2e8f0"}
                  strokeWidth="2"
                  strokeLinecap="round"
                  animate={{ opacity: look.brow ? 1 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <motion.path
                    d="M27.5 0 H36.5"
                    animate={{ y: look.brow?.y ?? 22, rotate: look.brow?.tilt ?? 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    style={{ originX: 0.5, originY: 0.5 }}
                  />
                  <motion.path
                    d="M45.5 0 H54.5"
                    animate={{ y: (look.brow?.y ?? 22) - (look.brow?.liftRight ?? 0), rotate: -(look.brow?.tilt ?? 0) }}
                    transition={{ type: "spring", stiffness: 260, damping: 18 }}
                    style={{ originX: 0.5, originY: 0.5 }}
                  />
                </motion.g>

                {/* eyes: emotion sets how open they are, the inner group blinks */}
                <motion.g
                  animate={{ scaleY: feeling === "happy" ? 1 : look.eyes }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  style={{ originX: 0.5, originY: 0.5, filter: `drop-shadow(0 0 2.5px ${a.color})` }}
                >
                  <motion.g
                    style={{ originX: 0.5, originY: 0.5 }}
                    animate={{ scaleY: [1, 1, 0.1, 1] }}
                    transition={{ duration: 3.6, times: [0, 0.92, 0.96, 1], repeat: Infinity, delay: id.length * 0.31 }}
                  >
                    <Eyes id={id} color={a.color} smiling={feeling === "happy"} />
                  </motion.g>
                </motion.g>
                {id === "quant" && <Glasses />}

                {/* mouth: moves while talking, otherwise holds the emotion's shape */}
                {talking ? (
                  <motion.ellipse cx="40.5" cy="37.2" rx="3.4" fill={a.color} animate={{ ry: [0.8, 2.8, 1.2, 2.4, 0.8] }} transition={loop(0.42)} />
                ) : (
                  <motion.path
                    fill={look.open ? a.color : "none"}
                    stroke={a.color}
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={false}
                    animate={{ d: mouthPath(look.mouth) }}
                    transition={{ duration: 0.3 }}
                  />
                )}
              </motion.g>
            </motion.g>
          </motion.g>

          {thinking ? (
            <g fill={a.color}>
              {[
                { cx: 63, cy: 7, r: 1.8 },
                { cx: 69, cy: 1, r: 2.6 },
                { cx: 76.5, cy: -6.5, r: 3.6 },
              ].map((d, i) => (
                <motion.circle key={i} {...d} animate={{ opacity: [0.15, 1, 0.15] }} transition={loop(1.1, i * 0.22)} />
              ))}
            </g>
          ) : (
            <Emote emotion={feeling} unflip={facing} />
          )}
        </motion.g>
      </motion.g>
    </svg>
  );
}
