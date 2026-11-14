import { describe, expect, it } from 'bun:test';
import { parseInFrame, parseOutFrame } from '@/engawa/protocol';

const j = (v: unknown) => JSON.stringify(v);

describe('parseInFrame', () => {
  it('parses welcome and drops malformed players', () => {
    const f = parseInFrame(
      j({
        type: 'welcome',
        self: { userId: 'me', name: 'bot', x: 1, y: 2, outfit: {} },
        players: [{ userId: 'a', name: 'A', x: 3, y: 4 }, { userId: 'b' }],
        bootId: 'x',
      }),
    );
    expect(f).toEqual({
      type: 'welcome',
      self: { userId: 'me', name: 'bot', x: 1, y: 2 },
      players: [{ userId: 'a', name: 'A', x: 3, y: 4 }],
    });
  });

  it('parses knock, group-update, transcript', () => {
    expect(parseInFrame(j({ type: 'knock', from: 'a', name: 'A' }))).toEqual({
      type: 'knock',
      from: 'a',
      name: 'A',
    });
    expect(parseInFrame(j({ type: 'group-update', method: 'sfu', members: ['a', 'b'] }))).toEqual({
      type: 'group-update',
      members: ['a', 'b'],
    });
    expect(
      parseInFrame(j({ type: 'transcript', speakerId: 'a', speakerName: 'A', text: 'hi', at: 5 })),
    ).toEqual({ type: 'transcript', speakerId: 'a', speakerName: 'A', text: 'hi', at: 5 });
  });

  it('returns null for unknown, malformed or non-JSON frames', () => {
    expect(parseInFrame(j({ type: 'pong' }))).toBeNull();
    expect(parseInFrame(j({ type: 'knock', from: 1 }))).toBeNull();
    expect(parseInFrame(j({ type: 'group-update', members: [1] }))).toBeNull();
    expect(parseInFrame('not json')).toBeNull();
    expect(parseInFrame(j([1, 2]))).toBeNull();
  });
});

describe('parseOutFrame', () => {
  it('parses move with and without a zone', () => {
    expect(
      parseOutFrame(j({ type: 'move', x: 1, y: 2, vx: 0, vy: 0, zoneId: 'meeting-1' })),
    ).toEqual({
      type: 'move',
      x: 1,
      y: 2,
      zoneId: 'meeting-1',
    });
    expect(parseOutFrame(j({ type: 'move', x: 1, y: 2, vx: 0, vy: 0 }))).toEqual({
      type: 'move',
      x: 1,
      y: 2,
      zoneId: null,
    });
  });

  it('parses recording, transcribing and status', () => {
    expect(parseOutFrame(j({ type: 'recording', recording: true }))).toEqual({
      type: 'recording',
      recording: true,
    });
    expect(parseOutFrame(j({ type: 'transcribing', transcribing: false }))).toEqual({
      type: 'transcribing',
      transcribing: false,
    });
    expect(
      parseOutFrame(j({ type: 'status', status: 'online', isMuted: true, isVideoOn: false })),
    ).toEqual({
      type: 'status',
      isMuted: true,
      isVideoOn: false,
    });
  });
});
