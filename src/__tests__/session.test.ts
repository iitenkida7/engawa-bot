import { describe, expect, it } from 'bun:test';
import { DEFAULT_LIMITS, type SessionState, step } from '@/bot/session';

const L = { headingTimeoutMs: 100, callerGraceMs: 10, maxMeetingMs: 1000 };
const idle: SessionState = { kind: 'idle' };
const names = { me: 'bot', a: 'Alice', b: 'Bob' };
const group = (members: string[]) => ({ type: 'group' as const, members, myId: 'me', names });

function meeting(now = 0) {
  const s1 = step(idle, { type: 'knock', from: 'a', name: 'Alice' }, now, L).state;
  return step(s1, group(['me', 'a']), now, L).state;
}

describe('session', () => {
  it('accepts a knock while idle and heads to the caller', () => {
    const r = step(idle, { type: 'knock', from: 'a', name: 'Alice' }, 0, L);
    expect(r.state).toEqual({ kind: 'heading', caller: { userId: 'a', name: 'Alice' }, since: 0 });
    expect(r.actions).toEqual([{ type: 'accept-knock', from: 'a', name: 'Alice' }]);
  });

  it('declines knocks while busy, keeping the current job', () => {
    const s = meeting();
    const r = step(s, { type: 'knock', from: 'b', name: 'Bob' }, 1, L);
    expect(r.state).toBe(s);
    expect(r.actions).toEqual([{ type: 'decline-knock', from: 'b', name: 'Bob' }]);
  });

  it('starts the meeting once it shares a call with the caller', () => {
    const heading = step(idle, { type: 'knock', from: 'a', name: 'Alice' }, 0, L).state;
    // A call with someone else on the way does not count.
    expect(step(heading, group(['me', 'b']), 5, L).actions).toEqual([]);
    const r = step(heading, group(['me', 'a', 'b']), 5, L);
    expect(r.actions).toEqual([{ type: 'start-meeting' }]);
    expect(r.state).toMatchObject({
      kind: 'meeting',
      startedAt: 5,
      participants: ['Alice', 'Bob'],
    });
  });

  it('gives up when the caller is never reached', () => {
    const heading = step(idle, { type: 'knock', from: 'a', name: 'Alice' }, 0, L).state;
    expect(step(heading, { type: 'tick' }, 99, L).actions).toEqual([]);
    const r = step(heading, { type: 'tick' }, 100, L);
    expect(r.state).toEqual(idle);
    expect(r.actions).toEqual([{ type: 'give-up', caller: { userId: 'a', name: 'Alice' } }]);
  });

  it('remembers everyone who joined during the meeting', () => {
    let s = meeting();
    s = step(s, group(['me', 'a', 'b']), 1, L).state;
    s = step(s, group(['me', 'a']), 2, L).state;
    expect(s).toMatchObject({ participants: ['Alice', 'Bob'] });
  });

  it('ends after the caller has been gone for the grace period', () => {
    let s = meeting();
    s = step(s, group(['me', 'b']), 100, L).state; // caller dropped out
    expect(step(s, { type: 'tick' }, 109, L).actions).toEqual([]);
    const r = step(s, { type: 'tick' }, 110, L);
    expect(r.state).toEqual(idle);
    expect(r.actions).toEqual([
      {
        type: 'end-meeting',
        reason: 'caller-left',
        caller: { userId: 'a', name: 'Alice' },
        startedAt: 0,
        endedAt: 110,
        participants: ['Alice', 'Bob'],
      },
    ]);
  });

  it('keeps going when the caller comes back within the grace period', () => {
    let s = meeting();
    s = step(s, group(['me']), 100, L).state;
    s = step(s, group(['me', 'a']), 105, L).state;
    expect(step(s, { type: 'tick' }, 200, L).actions).toEqual([]);
  });

  it('stops at the maximum length', () => {
    const r = step(meeting(), { type: 'tick' }, 1000, L);
    expect(r.actions[0]).toMatchObject({ type: 'end-meeting', reason: 'max-duration' });
  });

  it('has sane defaults', () => {
    expect(DEFAULT_LIMITS.callerGraceMs).toBeGreaterThan(0);
    expect(DEFAULT_LIMITS.maxMeetingMs).toBeGreaterThan(DEFAULT_LIMITS.headingTimeoutMs);
  });
});
