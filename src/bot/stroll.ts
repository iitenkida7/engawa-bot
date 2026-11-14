// Idle wandering. The bot lives outside the busy floor and only moves now and
// then — enough to look alive, not enough to be a distraction. It also keeps
// its distance from people: an avatar that drifts into someone's range would
// start a call (and play the proximity chime) for no reason.

import type { Point } from '@/engawa/world';

// engawa's tile edge in world px (TILE_SIZE in engawa/maps/map-def.ts).
export const TILE_PX = 50;

// World-px center of tile (c, r).
export function tileCenter(c: number, r: number): Point {
  return { x: (c + 0.5) * TILE_PX, y: (r + 0.5) * TILE_PX };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Where to stroll to next, or null to stay put. Stays put while anyone is near
// us (they may be on their way to knock); otherwise picks a random waypoint
// that is clear of people and is not where we already are (within two tiles:
// a walk target snaps to the nearest walkable tile, so we rarely land on it exactly).
export function pickStrollTarget(opts: {
  points: Point[];
  self: Point;
  people: Point[];
  avoidRadius: number;
  rng: () => number;
}): Point | null {
  const { points, self, people, avoidRadius, rng } = opts;
  if (people.some((p) => distance(p, self) < avoidRadius)) return null;
  const options = points.filter(
    (pt) => distance(pt, self) > 2 * TILE_PX && people.every((p) => distance(p, pt) >= avoidRadius),
  );
  if (options.length === 0) return null;
  return options[Math.floor(rng() * options.length)] ?? null;
}

// Random delay until the next stroll, uniformly in [minMs, maxMs].
export function nextStrollDelay(minMs: number, maxMs: number, rng: () => number): number {
  return minMs + rng() * Math.max(0, maxMs - minMs);
}
