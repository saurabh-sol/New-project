/** What was said in past sessions: kept so agents can avoid repeating it, and so any server can replay the latest session. */
import type { Stage } from "@/lib/council-types";
import type { AgentId } from "@/lib/types";
import { db, hasDb } from "../db";

const KEEP_LINES = 8;

// Without a database, memory lasts as long as this server process.
const shared = globalThis as typeof globalThis & { __councilLines?: Record<string, string[]>; __councilRounds?: Map<number, Stage[]> };
const localLines = () => (shared.__councilLines ??= {});
const localRounds = () => (shared.__councilRounds ??= new Map());

interface Spoken {
  agent: AgentId;
  kind: string;
  say: string;
}

function spokenIn(stages: Stage[]): Spoken[] {
  const out: Spoken[] = [];
  for (const s of stages) {
    if (s.stage === "pitches") for (const p of s.pitches) out.push({ agent: p.agent, kind: "pitch", say: p.say });
    if (s.stage === "debate") {
      for (const e of s.exchanges) {
        out.push({ agent: e.challenge.agent, kind: "debate", say: e.challenge.say });
        out.push({ agent: e.reply.agent, kind: "debate", say: e.reply.say });
      }
    }
    if (s.stage === "decision") {
      for (const p of s.pledges) out.push({ agent: p.agent, kind: "pledge", say: p.say });
      out.push({ agent: s.closing.agent, kind: "closing", say: s.closing.say });
    }
  }
  return out;
}

export async function saveRound(round: number, stages: Stage[], failed: boolean): Promise<void> {
  const lines = spokenIn(stages);
  if (!hasDb()) {
    localRounds().set(round, stages);
    for (const l of lines) (localLines()[l.agent] ??= []).push(l.say);
    return;
  }
  const sql = await db();
  await sql`
    insert into council_rounds (round, stages, failed) values (${round}, ${JSON.stringify(stages)}::jsonb, ${failed})
    on conflict (round) do update set stages = excluded.stages, failed = excluded.failed`;
  if (failed || lines.length === 0) return;
  await sql`
    insert into agent_lines (round, agent, kind, say)
    select ${round}, l.agent, l.kind, l.say
    from jsonb_to_recordset(${JSON.stringify(lines)}::jsonb) as l(agent text, kind text, say text)`;
}

/** A finished session's stages, for replay. Null if it isn't stored or it failed. */
export async function loadRound(round: number): Promise<Stage[] | null> {
  if (!hasDb()) return localRounds().get(round) ?? null;
  const sql = await db();
  const [row] = await sql`select stages from council_rounds where round = ${round} and not failed`;
  return row ? (row.stages as Stage[]) : null;
}

export interface PastSession {
  round: number;
  stages: Stage[];
}

/** Finished sessions before `before`, newest first, and whether there are older ones still. */
export async function loadHistory(before: number, limit: number): Promise<{ sessions: PastSession[]; more: boolean }> {
  let rows: PastSession[];
  if (hasDb()) {
    const sql = await db();
    const found = await sql`select round, stages from council_rounds where round < ${before} and not failed order by round desc limit ${limit + 1}`;
    rows = found.map((r) => ({ round: Number(r.round), stages: r.stages as Stage[] }));
  } else {
    rows = [...localRounds()]
      .filter(([round]) => round < before)
      .sort(([a], [b]) => b - a)
      .slice(0, limit + 1)
      .map(([round, stages]) => ({ round, stages }));
  }
  return { sessions: rows.slice(0, limit), more: rows.length > limit };
}

const LOOK_BACK = 24;
const KEEP_ABOUT = 6;

/**
 * What each agent said in earlier sessions that debated this token, oldest first.
 * A token that comes up again should not get the same speeches again.
 */
export async function linesAbout(token: string, before: number): Promise<Record<AgentId, string[]>> {
  const out: Record<AgentId, string[]> = { quant: [], degen: [], guardian: [], oracle: [] };
  let sessions: Stage[][];
  if (hasDb()) {
    const sql = await db();
    const rows = await sql`select stages from council_rounds where round < ${before} and round >= ${before - LOOK_BACK} and not failed order by round`;
    sessions = rows.map((r) => r.stages as Stage[]);
  } else {
    sessions = [...localRounds()].filter(([round]) => round < before && round >= before - LOOK_BACK).sort(([a], [b]) => a - b).map(([, stages]) => stages);
  }
  for (const stages of sessions) {
    const about = stages.some((s) => s.stage === "pitches" && s.proposal?.token === token);
    if (about) for (const l of spokenIn(stages)) out[l.agent].push(l.say);
  }
  for (const a of Object.keys(out) as AgentId[]) out[a] = out[a].slice(-KEEP_ABOUT);
  return out;
}

/** Each agent's latest lines, oldest first. */
export async function recentLines(): Promise<Record<AgentId, string[]>> {
  const out: Record<AgentId, string[]> = { quant: [], degen: [], guardian: [], oracle: [] };
  if (!hasDb()) {
    for (const a of Object.keys(out) as AgentId[]) out[a] = (localLines()[a] ?? []).slice(-KEEP_LINES);
    return out;
  }
  const sql = await db();
  const rows = await sql`
    select agent, say from (
      select agent, say, id, row_number() over (partition by agent order by id desc) as n from agent_lines
    ) ranked
    where n <= ${KEEP_LINES}
    order by id`;
  for (const r of rows) if (r.agent in out) out[r.agent as AgentId].push(r.say as string);
  return out;
}
