import { describe, expect, it } from 'bun:test';
import { nextStrollDelay, pickStrollTarget, TILE_PX, tileCenter } from '@/bot/stroll';

const points = [tileCenter(0, 0), tileCenter(10, 0), tileCenter(20, 0)];

describe('pickStrollTarget', () => {
  it('stays put while someone is near', () => {
    const self = tileCenter(0, 0);
    const r = pickStrollTarget({
      points,
      self,
      people: [{ x: self.x + 100, y: self.y }],
      avoidRadius: 400,
      rng: () => 0,
    });
    expect(r).toBeNull();
  });

  it('skips the current spot and spots near people', () => {
    const self = tileCenter(0, 0);
    const people = [tileCenter(10, 1)];
    for (const v of [0, 0.5, 0.99]) {
      expect(pickStrollTarget({ points, self, people, avoidRadius: 400, rng: () => v })).toEqual(
        tileCenter(20, 0),
      );
    }
  });

  it('treats a spot within two tiles as where we already are', () => {
    // A walk target snaps to the nearest walkable tile, so we stop short of it.
    const self = { x: tileCenter(10, 0).x + 70, y: tileCenter(10, 0).y };
    const r = pickStrollTarget({
      points: [tileCenter(10, 0)],
      self,
      people: [],
      avoidRadius: 400,
      rng: () => 0,
    });
    expect(r).toBeNull();
  });

  it('returns null when there is nowhere to go', () => {
    expect(
      pickStrollTarget({
        points: [],
        self: { x: 0, y: 0 },
        people: [],
        avoidRadius: 400,
        rng: () => 0,
      }),
    ).toBeNull();
  });
});

describe('helpers', () => {
  it('tileCenter is the middle of the tile', () => {
    expect(tileCenter(2, 3)).toEqual({ x: 2.5 * TILE_PX, y: 3.5 * TILE_PX });
  });

  it('nextStrollDelay spans [min, max]', () => {
    expect(nextStrollDelay(10, 20, () => 0)).toBe(10);
    expect(nextStrollDelay(10, 20, () => 1)).toBe(20);
  });
});
