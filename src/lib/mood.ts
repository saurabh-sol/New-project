/**
 * How an agent feels, which is what its face shows.
 *
 * A face follows what is happening to the agent: a trade it believes in, a proposal it doubts,
 * a gain, a loss. It is not left to the model to choose, because a model picks strong feelings
 * for ordinary remarks. Anger has its place, where there is cause for it:
 *
 *   - an agent challenges a trade it is strongly against
 *   - a proposal its leader was sure of is turned down with hardly a vote behind it
 *   - an agent is put out of a position at a loss, by its stop or by a falling price
 */
import type { Emotion } from "./council";

export type Moment =
  /** `losing`: a sale of a position that is under water. */
  | { kind: "pitch"; action: "BUY" | "SELL" | "HOLD"; conviction: number; losing?: boolean }
  /**
   * `agrees`: the challenger pitched the same trade itself.
   * `against`: it pitched the opposite, or was sure of a trade of its own.
   */
  | { kind: "challenge"; agrees: boolean; against?: boolean }
  | { kind: "reply" }
  | { kind: "pledge"; support: boolean }
  /**
   * `alone`: the council did not back the trade, and the leader takes it by itself.
   * `conviction` is the leader's own, and `yes` the votes behind the trade, the leader's included.
   */
  | { kind: "closing"; approved: boolean; alone: boolean; conviction?: number; yes?: number };

export function moodFor(m: Moment): Emotion {
  switch (m.kind) {
    case "pitch":
      if (m.action === "BUY") return m.conviction >= 4 ? "confident" : "neutral";
      return m.action === "SELL" && m.losing ? "worried" : "neutral";
    case "challenge":
      return m.agrees ? "confident" : m.against ? "annoyed" : "skeptical";
    case "reply":
      return "neutral";
    case "pledge":
      return m.support ? "confident" : "neutral";
    case "closing":
      if (m.approved) return "happy";
      // Sure of the trade, and left standing alone with it.
      if ((m.conviction ?? 0) >= 4 && (m.yes ?? 4) <= 1) return "annoyed";
      return m.alone ? "confident" : "neutral";
  }
}

/**
 * The feeling shown for a line from a session on record. `fitted` says the session's faces
 * already follow the situation. Older sessions carry whatever the model chose, and the strong
 * feelings in them are brought down.
 */
export const spokenMood = (e: Emotion | undefined, fitted = false): Emotion =>
  fitted ? (e ?? "neutral") : e === "annoyed" ? "skeptical" : e === "sad" || e === "excited" ? "neutral" : (e ?? "neutral");

/** Gains and losses smaller than these, in USDG, are nothing to cheer or to mourn. */
const A_GAIN = 0.25;
const A_LOSS = -0.5;

/**
 * How an agent takes the result of a sale. `forced`: it was put out of the position, by its
 * stop-loss or by a falling price, and did not choose to sell. That is what angers.
 */
export const resultMood = (realized: number, forced = false): Emotion => (realized >= A_GAIN ? "happy" : realized <= A_LOSS ? (forced ? "annoyed" : "sad") : "neutral");

/** How an agent feels about where its book stands, in percent of what it has in trades. */
export const bookMood = (pct: number): Emotion => (pct >= 1 ? "happy" : pct <= -3 ? "worried" : "neutral");
