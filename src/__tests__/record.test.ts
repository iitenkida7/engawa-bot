import { describe, expect, it } from 'bun:test';
import {
  folderName,
  type MeetingRecord,
  notificationText,
  peopleLabel,
  summaryDocText,
  transcriptText,
} from '@/meeting/record';

// 2026-11-14 05:30:00 UTC = 14:30 in Tokyo.
const T0 = Date.UTC(2026, 10, 14, 5, 30, 0);
const m: MeetingRecord = {
  callerName: 'Alice',
  participants: ['Alice', 'Bob'],
  roomName: 'Room A',
  startedAt: T0,
  endedAt: T0 + 50 * 60_000,
  videoPath: null,
  lines: [
    { at: T0 + 65_000, speakerId: 'b', speakerName: 'Bob', text: 'second' },
    { at: T0 + 5_000, speakerId: 'a', speakerName: 'Alice', text: 'first' },
  ],
};
const tz = 'Asia/Tokyo';

describe('meeting record formatting', () => {
  it('names the folder by local date, time and room', () => {
    expect(folderName(m, { tz, lang: 'en' })).toBe('2026-11-14 1430 Room A (Alice, Bob)');
    expect(folderName(m, { tz, lang: 'ja' })).toBe('2026-11-14 1430 Room A (Alice、Bob)');
    expect(folderName({ ...m, roomName: 'a/b:c' }, { tz: 'UTC', lang: 'en' })).toBe(
      '2026-11-14 0530 a_b_c (Alice, Bob)',
    );
    // On the open floor there is no room name; just who was there.
    expect(folderName({ ...m, roomName: null }, { tz, lang: 'en' })).toBe(
      '2026-11-14 1430 (Alice, Bob)',
    );
    // Nobody recorded as a participant: fall back to the caller.
    expect(folderName({ ...m, participants: [] }, { tz, lang: 'en' })).toBe(
      '2026-11-14 1430 Room A (Alice)',
    );
  });

  it('lists up to four people, then counts the rest', () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'];
    expect(peopleLabel(six, 'ja')).toBe('A、B、C、D 他2名');
    expect(peopleLabel(six, 'en')).toBe('A, B, C, D +2');
    expect(peopleLabel(['A'], 'ja')).toBe('A');
  });

  it('writes the transcript in time order', () => {
    expect(transcriptText(m.lines, tz)).toBe('[14:30:05] Alice: first\n[14:31:05] Bob: second');
  });

  it('builds the summary document with links', () => {
    const text = summaryDocText(
      m,
      { highlights: ['A wins'], body: '- detail' },
      {
        tz,
        lang: 'en',
        links: { video: 'https://v', transcript: 'https://t' },
      },
    );
    expect(text).toContain('When: 2026-11-14 14:30–15:20');
    expect(text).toContain('Participants: Alice, Bob');
    expect(text).toContain('・A wins');
    expect(text).toContain('- detail');
    expect(text).toContain('Recording: https://v');
    expect(text).toContain('Transcript: https://t');
  });

  it('keeps the notification short', () => {
    const short = notificationText(m, { highlights: ['x'], body: '' }, { tz, lang: 'ja' });
    expect(short).toBe('2026-11-14 14:30–15:20 Room A (Alice、Bob)\n・x');
    const long = notificationText(
      m,
      { highlights: ['y'.repeat(2000)], body: '' },
      { tz, lang: 'ja' },
    );
    expect(long.length).toBe(900);
  });
});
