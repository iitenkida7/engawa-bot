import { describe, expect, it } from 'bun:test';
import type { MeetingRecord } from '@/meeting/record';
import { buildMessages, clipTranscript, parseSummary, summarize } from '@/meeting/summarize';

const m: MeetingRecord = {
  callerName: 'Alice',
  participants: ['Alice', 'Bob'],
  roomName: 'Room A',
  startedAt: 0,
  endedAt: 1,
  videoPath: null,
  lines: [{ at: 0, speakerId: 'a', speakerName: 'Alice', text: 'hello' }],
};

describe('parseSummary', () => {
  it('reads JSON, even inside a code fence', () => {
    expect(parseSummary('```json\n{"highlights":["a"," ","b"],"summary":" body "}\n```')).toEqual({
      highlights: ['a', 'b'],
      body: 'body',
    });
  });

  it('caps highlights at five', () => {
    const s = parseSummary(
      JSON.stringify({ highlights: ['1', '2', '3', '4', '5', '6'], summary: '' }),
    );
    expect(s.highlights).toHaveLength(5);
  });

  it('falls back to the raw text', () => {
    expect(parseSummary('just prose')).toEqual({ highlights: [], body: 'just prose' });
  });
});

describe('prompt', () => {
  it('includes room, participants and the transcript', () => {
    const [sys, user] = buildMessages(m, { tz: 'UTC', lang: 'ja' });
    expect(sys?.content).toContain('JSON');
    expect(user?.content).toContain('Room: Room A');
    expect(user?.content).toContain('Participants: Alice, Bob');
    expect(user?.content).toContain('Alice: hello');
  });

  it('clips long transcripts keeping head and tail', () => {
    const t = `${'a'.repeat(100)}${'b'.repeat(100)}`;
    const c = clipTranscript(t, 50);
    expect(c.startsWith('a'.repeat(20))).toBe(true);
    expect(c.endsWith('b'.repeat(30))).toBe(true);
    expect(clipTranscript('short', 50)).toBe('short');
  });
});

describe('summarize', () => {
  it('posts to Groq with the key and model, and parses the reply', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return Response.json({
        choices: [{ message: { content: '{"highlights":["x"],"summary":"y"}' } }],
      });
    }) as unknown as typeof fetch;
    const s = await summarize(m, {
      apiKey: 'k',
      model: 'mdl',
      tz: 'UTC',
      lang: 'en',
      fetch: fakeFetch,
    });
    expect(s).toEqual({ highlights: ['x'], body: 'y' });
    expect(seen!.url).toContain('api.groq.com');
    expect(new Headers(seen!.init.headers).get('authorization')).toBe('Bearer k');
    expect(JSON.parse(String(seen!.init.body)).model).toBe('mdl');
  });

  it('skips the call when nothing was said', async () => {
    const fail = (() => {
      throw new Error('should not be called');
    }) as unknown as typeof fetch;
    expect(
      await summarize(
        { ...m, lines: [] },
        { apiKey: 'k', model: 'm', tz: 'UTC', lang: 'en', fetch: fail },
      ),
    ).toEqual({
      highlights: [],
      body: '',
    });
  });

  it('throws on HTTP errors', async () => {
    const bad = (async () => new Response('nope', { status: 429 })) as unknown as typeof fetch;
    await expect(
      summarize(m, { apiKey: 'k', model: 'm', tz: 'UTC', lang: 'en', fetch: bad }),
    ).rejects.toThrow('429');
  });
});
