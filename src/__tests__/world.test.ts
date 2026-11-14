import { describe, expect, it } from 'bun:test';
import { World } from '@/engawa/world';

function welcomed() {
  const w = new World();
  w.applyIn({
    type: 'welcome',
    self: { userId: 'me', name: 'bot', x: 0, y: 0 },
    players: [
      { userId: 'me', name: 'bot', x: 0, y: 0 },
      { userId: 'a', name: 'Alice', x: 10, y: 10 },
    ],
  });
  return w;
}

describe('World', () => {
  it('tracks self and others from welcome, never listing self as a player', () => {
    const w = welcomed();
    expect(w.myId).toBe('me');
    expect([...w.players.keys()]).toEqual(['a']);
  });

  it('follows joins, moves and leaves', () => {
    const w = welcomed();
    w.applyIn({ type: 'player-joined', player: { userId: 'b', name: 'Bob', x: 1, y: 1 } });
    w.applyIn({ type: 'player-moved', userId: 'b', x: 5, y: 6 });
    expect(w.players.get('b')).toEqual({ userId: 'b', name: 'Bob', x: 5, y: 6 });
    w.applyIn({ type: 'player-left', userId: 'b' });
    expect(w.players.has('b')).toBe(false);
  });

  it('turns knocks and group updates into events', () => {
    const w = welcomed();
    expect(w.applyIn({ type: 'knock', from: 'a', name: 'Alice' })).toEqual({
      type: 'knock',
      from: 'a',
      name: 'Alice',
    });
    expect(w.applyIn({ type: 'group-update', members: ['me', 'a'] })).toEqual({
      type: 'group',
      members: ['me', 'a'],
    });
    expect(w.group).toEqual(['me', 'a']);
  });

  it('collects transcript lines from both directions, resolving our own speaker names', () => {
    const w = welcomed();
    w.applyIn({ type: 'transcript', speakerId: 'b', speakerName: 'Bob', text: 'relayed', at: 2 });
    w.applyOut({ type: 'transcript', speakerId: 'a', text: 'ours', at: 1 });
    expect(w.takeTranscript()).toEqual([
      { at: 2, speakerId: 'b', speakerName: 'Bob', text: 'relayed' },
      { at: 1, speakerId: 'a', speakerName: 'Alice', text: 'ours' },
    ]);
    expect(w.takeTranscript()).toEqual([]);
  });

  it('tracks own position, zone, recording, transcribing and media', () => {
    const w = welcomed();
    w.applyOut({ type: 'move', x: 3, y: 4, zoneId: 'meeting-1' });
    w.applyOut({ type: 'recording', recording: true });
    w.applyOut({ type: 'transcribing', transcribing: true });
    w.applyOut({ type: 'status', isMuted: false, isVideoOn: false });
    expect(w.myPos).toEqual({ x: 3, y: 4 });
    expect(w.myZoneId).toBe('meeting-1');
    expect(w.recording && w.transcribing && w.micOn).toBe(true);
    expect(w.camOn).toBe(false);
  });

  it('knows when someone else in the call is already transcribing', () => {
    const w = welcomed();
    w.applyIn({ type: 'player-transcribing', userId: 'a', transcribing: true });
    expect(w.someoneElseTranscribing()).toBe(false); // not in our call
    w.applyIn({ type: 'group-update', members: ['me', 'a'] });
    expect(w.someoneElseTranscribing()).toBe(true);
    w.applyIn({ type: 'player-left', userId: 'a' });
    expect(w.someoneElseTranscribing()).toBe(false);
  });
});
