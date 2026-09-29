import { create } from "zustand";
import { AGENT_ORDER } from "@/lib/agents";
import type { DeskAsset } from "@/lib/assets";
import { agentPnl, newPortfolio, type Emotion, type Fill, type Portfolio } from "@/lib/council";
import type { CouncilMode, ModelInfo } from "@/lib/council-types";
import { pointOf, sameSpot } from "@/lib/layout";
import type { AssetKey, Prices } from "@/lib/market";
import type { AgentId, AgentState, ArenaEvent, ChatMessage, Phase, Pt, Spot } from "@/lib/types";

export interface AgentRuntime {
  state: AgentState;
  emotion: Emotion;
  spot: Spot;
  walking: boolean;
  vote: boolean | null;
  voteReason: string;
  /** The vote was on whether to join a trade already decided, so it reads IN or OUT. */
  joining: boolean;
  bubble: ChatMessage | null;
  /** PnL samples over this viewing session, for sparklines. */
  history: number[];
}

export interface Coin { id: string; from: Pt; to: Pt; amount: number }
export interface Ticket { id: string; fill: Fill }

interface ArenaStore {
  /** False until the first snapshot arrives from the server. */
  ready: boolean;
  round: number;
  phase: Phase;
  mode: CouncilMode;
  modeNote: string | null;
  models: Record<AgentId, ModelInfo> | null;
  /** The session on stage carries out a funder's commitment, so the agents join or stay out instead of voting. */
  committed: boolean;
  /** Token the council is discussing, which the chart follows. */
  focus: AssetKey | null;
  consensus: number;
  portfolio: Portfolio;
  /** Tokens funders asked the desk to trade. */
  assets: Record<AssetKey, DeskAsset>;
  fills: Fill[];
  /** Server clock minus this browser's clock, in ms. */
  clockSkew: number;
  nextRoundAt: number | null;
  agents: Record<AgentId, AgentRuntime>;
  messages: ChatMessage[];
  coins: Coin[];
  tickets: Ticket[];
  apply: (e: ArenaEvent) => void;
  arrive: (id: AgentId) => void;
  samplePnl: (prices: Prices) => void;
  removeCoin: (id: string) => void;
  removeTicket: (id: string) => void;
}

const freshAgent = (): AgentRuntime => ({
  state: "idle",
  emotion: "neutral",
  spot: { kind: "home" },
  walking: false,
  vote: null,
  voteReason: "",
  joining: false,
  bubble: null,
  history: [],
});

const MAX_MESSAGES = 120;
const MAX_HISTORY = 60;
/** Coins fly at chest height, not along the floor. */
const CHEST = 9;

const byTime = (a: Fill, b: Fill) => b.ts - a.ts;

export const useArena = create<ArenaStore>((set) => ({
  ready: false,
  round: 0,
  phase: "monitor",
  mode: "live",
  modeNote: null,
  models: null,
  committed: false,
  focus: null,
  consensus: 0,
  portfolio: newPortfolio(),
  assets: {},
  fills: [],
  clockSkew: 0,
  nextRoundAt: null,
  agents: { quant: freshAgent(), degen: freshAgent(), guardian: freshAgent(), oracle: freshAgent() },
  messages: [],
  coins: [],
  tickets: [],

  apply: (e) =>
    set((s) => {
      const patchAgent = (id: AgentId, patch: Partial<AgentRuntime>) => ({
        agents: { ...s.agents, [id]: { ...s.agents[id], ...patch } },
      });
      const patchAll = (patch: Partial<AgentRuntime>) => {
        const agents = { ...s.agents };
        for (const id of AGENT_ORDER) agents[id] = { ...agents[id], ...patch };
        return agents;
      };

      switch (e.type) {
        case "sync": {
          const snap = e.snapshot;
          return {
            ready: true,
            round: Math.max(s.round, snap.round),
            mode: snap.mode,
            modeNote: snap.modeNote,
            models: snap.models,
            portfolio: snap.portfolio,
            assets: { ...s.assets, ...snap.assets },
            fills: [...snap.fills].sort(byTime),
            clockSkew: snap.serverTime - Date.now(),
            nextRoundAt: snap.nextRoundAt,
          };
        }
        case "round_start":
          return {
            round: e.round,
            mode: e.mode,
            committed: !!e.committed,
            consensus: 0,
            focus: null,
            // While a session plays, show the desk as it stood when that session began.
            portfolio: e.portfolio,
            fills: s.fills.filter((f) => !(f.round === e.round && f.reason === "COUNCIL")),
            // A session watched in part and then started over must not leave its first lines behind.
            messages: s.messages.filter((m) => m.round !== e.round),
            agents: patchAll({ vote: null, voteReason: "", bubble: null }),
          };
        case "phase":
          // Votes are shown at the table only; drop them once the council moves on.
          if (e.phase === "execute" || e.phase === "settle" || e.phase === "monitor") {
            return { phase: e.phase, agents: patchAll({ vote: null, voteReason: "" }) };
          }
          return { phase: e.phase };
        case "focus":
          return { focus: e.token };
        case "assets":
          return { assets: { ...s.assets, ...e.assets } };
        case "agent_state": {
          const prev = s.agents[e.agent];
          // Drop the speech bubble once the agent stops talking.
          const bubble = e.state === "idle" || e.state === "thinking" ? null : prev.bubble;
          return patchAgent(e.agent, { state: e.state, bubble });
        }
        case "emotion":
          return patchAgent(e.agent, { emotion: e.emotion });
        case "move":
          if (sameSpot(s.agents[e.agent].spot, e.to)) return {};
          return patchAgent(e.agent, { spot: e.to, walking: true, bubble: null });
        case "message": {
          const m = e.message;
          const messages = [...s.messages, m].slice(-MAX_MESSAGES);
          // System notes and votes go to the transcript only. A vote shows on the floor as a YES/NO sign.
          if (m.kind === "system" || m.kind === "vote") return { messages };
          return { messages, ...patchAgent(m.agent, { bubble: m, emotion: m.emotion ?? s.agents[m.agent].emotion }) };
        }
        case "offer": {
          const from = pointOf(e.from, s.agents[e.from].spot);
          const to = pointOf(e.to, s.agents[e.to].spot);
          const coin = { id: e.id, amount: e.amount, from: { x: from.x, y: from.y - CHEST }, to: { x: to.x, y: to.y - CHEST } };
          return { coins: [...s.coins, coin] };
        }
        case "vote":
          return patchAgent(e.agent, { vote: e.approve, voteReason: e.reason, joining: !!e.joining });
        case "recap":
          return { messages: [...s.messages.filter((m) => m.round !== e.round), ...e.messages].slice(-MAX_MESSAGES) };
        case "consensus":
          return { consensus: e.value };
        case "fill":
          return {
            portfolio: e.portfolio,
            fills: [e.fill, ...s.fills.filter((f) => f.id !== e.fill.id)].sort(byTime),
            tickets: [...s.tickets, { id: e.fill.id, fill: e.fill }],
          };
        case "schedule":
          return { nextRoundAt: e.nextRoundAt };
      }
    }),

  arrive: (id) => set((s) => ({ agents: { ...s.agents, [id]: { ...s.agents[id], walking: false } } })),

  samplePnl: (prices) =>
    set((s) => {
      const agents = { ...s.agents };
      for (const id of AGENT_ORDER) {
        agents[id] = { ...agents[id], history: [...agents[id].history, agentPnl(s.portfolio, id, prices)].slice(-MAX_HISTORY) };
      }
      return { agents };
    }),

  removeCoin: (id) => set((s) => ({ coins: s.coins.filter((c) => c.id !== id) })),
  removeTicket: (id) => set((s) => ({ tickets: s.tickets.filter((t) => t.id !== id) })),
}));
