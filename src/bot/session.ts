// The bot's job lifecycle as a pure state machine: knocked → walk over → sit in
// on the meeting → wrap up when the caller leaves. Side effects (clicking
// buttons, uploading) are returned as actions for bot.ts to carry out, so every
// transition is unit-testable without a browser.

export type Caller = { userId: string; name: string };

export type SessionState =
  | { kind: 'idle' }
  // Accepted a knock; engawa is walking us over to the caller.
  | { kind: 'heading'; caller: Caller; since: number }
  // In the caller's call, recording and transcribing.
  | {
      kind: 'meeting';
      caller: Caller;
      startedAt: number;
      // When the caller dropped out of our call, or null while they are in it.
      callerAbsentSince: number | null;
      // Everyone who was in the call at some point (names, ourselves excluded).
      participants: string[];
    };

export type SessionEvent =
  | { type: 'knock'; from: string; name: string }
  // `names` resolves member ids; it should include everyone in `members`.
  | { type: 'group'; members: string[]; myId: string; names: Record<string, string> }
  | { type: 'tick' };

export type EndReason = 'caller-left' | 'max-duration';

export type SessionAction =
  | { type: 'accept-knock'; from: string; name: string }
  | { type: 'decline-knock'; from: string; name: string }
  | { type: 'start-meeting' }
  | {
      type: 'end-meeting';
      reason: EndReason;
      caller: Caller;
      startedAt: number;
      endedAt: number;
      participants: string[];
    }
  // Never reached the caller (they moved away, or the walk got stuck).
  | { type: 'give-up'; caller: Caller };

export type SessionLimits = {
  // How long to keep walking towards the caller before giving up.
  headingTimeoutMs: number;
  // How long the caller may be out of our call before the meeting is over.
  // Groups can briefly split while people shuffle around a room.
  callerGraceMs: number;
  // Hard cap on one recording.
  maxMeetingMs: number;
};

export const DEFAULT_LIMITS: SessionLimits = {
  headingTimeoutMs: 90_000,
  callerGraceMs: 15_000,
  maxMeetingMs: 3 * 60 * 60_000,
};

export type Step = { state: SessionState; actions: SessionAction[] };

const IDLE: SessionState = { kind: 'idle' };

function addNames(list: string[], names: string[]): string[] {
  const out = [...list];
  for (const n of names) if (n && !out.includes(n)) out.push(n);
  return out;
}

export function step(
  state: SessionState,
  event: SessionEvent,
  now: number,
  limits: SessionLimits = DEFAULT_LIMITS,
): Step {
  // One job at a time: a knock while busy is turned down politely (engawa shows
  // the knocker a "tied up right now" note).
  if (event.type === 'knock') {
    if (state.kind !== 'idle')
      return { state, actions: [{ type: 'decline-knock', from: event.from, name: event.name }] };
    return {
      state: { kind: 'heading', caller: { userId: event.from, name: event.name }, since: now },
      actions: [{ type: 'accept-knock', from: event.from, name: event.name }],
    };
  }

  if (state.kind === 'idle') return { state, actions: [] };

  if (state.kind === 'heading') {
    if (
      event.type === 'group' &&
      event.members.includes(state.caller.userId) &&
      event.members.includes(event.myId)
    ) {
      const others = event.members
        .filter((id) => id !== event.myId)
        .map((id) => event.names[id] ?? '');
      return {
        state: {
          kind: 'meeting',
          caller: state.caller,
          startedAt: now,
          callerAbsentSince: null,
          participants: addNames([], others),
        },
        actions: [{ type: 'start-meeting' }],
      };
    }
    if (now - state.since >= limits.headingTimeoutMs) {
      return { state: IDLE, actions: [{ type: 'give-up', caller: state.caller }] };
    }
    return { state, actions: [] };
  }

  // meeting
  let next = state;
  if (event.type === 'group') {
    const others = event.members
      .filter((id) => id !== event.myId)
      .map((id) => event.names[id] ?? '');
    const callerIn = event.members.includes(state.caller.userId);
    next = {
      ...state,
      participants: addNames(state.participants, others),
      callerAbsentSince: callerIn ? null : (state.callerAbsentSince ?? now),
    };
  }
  const end = (reason: EndReason): Step => ({
    state: IDLE,
    actions: [
      {
        type: 'end-meeting',
        reason,
        caller: next.caller,
        startedAt: next.startedAt,
        endedAt: now,
        participants: next.participants,
      },
    ],
  });
  if (next.callerAbsentSince !== null && now - next.callerAbsentSince >= limits.callerGraceMs) {
    return end('caller-left');
  }
  if (now - next.startedAt >= limits.maxMeetingMs) return end('max-duration');
  return { state: next, actions: [] };
}
