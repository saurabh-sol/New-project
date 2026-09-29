/**
 * Trading-floor geometry. All coordinates are % of the arena box; a point marks
 * where something touches the floor (feet of a character, base of a desk).
 * Shared by the UI (to animate walks) and the mock engine (to time them).
 */
import type { AgentId, Pt, Spot } from "./types";

/** Arena height / width on desktop, so vertical distance is weighted correctly. */
const ARENA_ASPECT = 11 / 16;
/** Walking speed, in % of arena width per second. Slow enough that the feet keep up with the floor. */
const WALK_SPEED = 13;

export const DESKS: Record<AgentId, Pt & { side: "left" | "right" }> = {
  quant: { x: 17, y: 44, side: "left" },
  degen: { x: 83, y: 44, side: "right" },
  guardian: { x: 17, y: 93, side: "left" },
  oracle: { x: 83, y: 93, side: "right" },
};

export const TABLE: Pt = { x: 50, y: 70 };

const TABLE_SPOTS: Record<AgentId, Pt> = {
  quant: { x: 36, y: 64 },
  degen: { x: 64, y: 64 },
  guardian: { x: 39.5, y: 81 },
  oracle: { x: 60.5, y: 81 },
};

/** +1 when the floor's center is to the right of this agent's desk. */
export const inward = (id: AgentId): 1 | -1 => (DESKS[id].side === "left" ? 1 : -1);

/** Behind the desk, next to the monitor. */
export const homePoint = (id: AgentId): Pt => ({ x: DESKS[id].x + inward(id) * 3.5, y: DESKS[id].y - 1.5 });

/** Where an agent steps out from behind its desk. */
const exitPoint = (id: AgentId): Pt => ({ x: DESKS[id].x + inward(id) * 15, y: DESKS[id].y - 1 });

/** Where a visitor stands at someone's desk. */
const visitorPoint = (owner: AgentId): Pt => ({ x: DESKS[owner].x + inward(owner) * 17, y: DESKS[owner].y + 1.5 });

export function pointOf(agent: AgentId, spot: Spot): Pt {
  switch (spot.kind) {
    case "home":
      return homePoint(agent);
    case "desk":
      return visitorPoint(spot.of);
    case "table":
      return TABLE_SPOTS[agent];
  }
}

/** Which way the agent looks once it has arrived. */
export function facingAt(agent: AgentId, spot: Spot): 1 | -1 {
  switch (spot.kind) {
    case "home":
      return inward(agent);
    case "desk":
      return inward(spot.of) === 1 ? -1 : 1;
    case "table":
      return TABLE_SPOTS[agent].x < TABLE.x ? 1 : -1;
  }
}

export const sameSpot = (a: Spot, b: Spot) =>
  a.kind === b.kind && (a.kind !== "desk" || (b.kind === "desk" && a.of === b.of));

// --- Routing: walk around the council table instead of through it. ---

const OBSTACLE = { x: 50, y: 69, rx: 13, ry: 7.5 };
const CORNERS: Pt[] = [
  { x: 31, y: 58 },
  { x: 69, y: 58 },
  { x: 31, y: 84 },
  { x: 69, y: 84 },
];

const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, (b.y - a.y) * ARENA_ASPECT);

function hits(a: Pt, b: Pt) {
  for (let i = 1; i < 20; i++) {
    const t = i / 20;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (((x - OBSTACLE.x) / OBSTACLE.rx) ** 2 + ((y - OBSTACLE.y) / OBSTACLE.ry) ** 2 < 1) return true;
  }
  return false;
}

function leg(a: Pt, b: Pt): Pt[] {
  if (!hits(a, b)) return [b];
  let best: Pt[] | null = null;
  let bestLen = Infinity;
  for (const w of CORNERS) {
    if (hits(a, w) || hits(w, b)) continue;
    const len = dist(a, w) + dist(w, b);
    if (len < bestLen) [best, bestLen] = [[w, b], len];
  }
  if (best) return best;
  for (const w1 of CORNERS) {
    for (const w2 of CORNERS) {
      if (w1 === w2 || hits(a, w1) || hits(w1, w2) || hits(w2, b)) continue;
      const len = dist(a, w1) + dist(w1, w2) + dist(w2, b);
      if (len < bestLen) [best, bestLen] = [[w1, w2, b], len];
    }
  }
  return best ?? [b];
}

/** Waypoints from one spot to another. `start` overrides the origin when already mid-walk. */
export function routeBetween(agent: AgentId, from: Spot, to: Spot, start?: Pt): Pt[] {
  const pts: Pt[] = [start ?? pointOf(agent, from)];
  if (sameSpot(from, to)) return pts;
  if (from.kind === "home") pts.push(exitPoint(agent));
  const target = to.kind === "home" ? exitPoint(agent) : pointOf(agent, to);
  pts.push(...leg(pts[pts.length - 1], target));
  if (to.kind === "home") pts.push(homePoint(agent));
  return pts;
}

const routeLength = (pts: Pt[]) => pts.slice(1).reduce((sum, p, i) => sum + dist(pts[i], p), 0);

/** Seconds needed to walk the route. */
export const routeDuration = (pts: Pt[]) => Math.max(routeLength(pts) / WALK_SPEED, 0.25);

/** Keyframe offsets (0..1) so speed stays constant across segments. */
export function routeTimes(pts: Pt[]): number[] {
  const total = Math.max(routeLength(pts), 0.001);
  let acc = 0;
  return pts.map((p, i) => {
    if (i > 0) acc += dist(pts[i - 1], p);
    return i === pts.length - 1 ? 1 : acc / total;
  });
}

export const walkSeconds = (agent: AgentId, from: Spot, to: Spot) => routeDuration(routeBetween(agent, from, to));
