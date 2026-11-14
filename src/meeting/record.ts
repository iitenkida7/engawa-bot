// One finished meeting, and how it is written out (folder name, transcript
// text, the summary document). Pure formatting, unit-tested.

import type { TranscriptLine } from '@/engawa/world';

export type MeetingRecord = {
  callerName: string;
  participants: string[];
  roomName: string | null;
  startedAt: number;
  endedAt: number;
  videoPath: string | null;
  lines: TranscriptLine[];
};

export type Summary = {
  // A few one-line takeaways, for the notification and the top of the doc.
  highlights: string[];
  // The longer summary (plain text, may contain "- " bullets).
  body: string;
};

// "YYYY-MM-DD HH:MM:SS" in `timeZone` (sv-SE happens to format exactly so).
function stamp(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(ms));
}

export const dateOf = (ms: number, tz: string) => stamp(ms, tz).slice(0, 10);
export const monthOf = (ms: number, tz: string) => stamp(ms, tz).slice(0, 7);
export const timeOf = (ms: number, tz: string) => stamp(ms, tz).slice(11, 16);
const clockOf = (ms: number, tz: string) => stamp(ms, tz).slice(11, 19);

// Names listed in a folder name before the rest are summarized as a count.
const FOLDER_MAX_NAMES = 4;

// "Alice, Bob" / "Alice、Bob" — with "+2" / "他2名" past FOLDER_MAX_NAMES.
export function peopleLabel(names: string[], lang: 'ja' | 'en'): string {
  const shown = names.slice(0, FOLDER_MAX_NAMES);
  const rest = names.length - shown.length;
  const list = shown.join(lang === 'ja' ? '、' : ', ');
  if (rest <= 0) return list;
  return lang === 'ja' ? `${list} 他${rest}名` : `${list} +${rest}`;
}

// Folder name for one meeting, e.g. "2026-11-14 1430 Meeting room A (Alice, Bob)".
export function folderName(m: MeetingRecord, o: { tz: string; lang: 'ja' | 'en' }): string {
  const people = m.participants.length ? m.participants : [m.callerName];
  const when = `${dateOf(m.startedAt, o.tz)} ${timeOf(m.startedAt, o.tz).replace(':', '')}`;
  const name = [when, m.roomName, `(${peopleLabel(people, o.lang)})`].filter(Boolean).join(' ');
  // Keep it a safe file name for local delivery as well.
  return name.replace(/[/\\:*?"<>|]/g, '_').trim();
}

// The transcript as plain text, one line per utterance, in time order.
export function transcriptText(lines: TranscriptLine[], tz: string): string {
  return [...lines]
    .sort((a, b) => a.at - b.at)
    .map((l) => `[${clockOf(l.at, tz)}] ${l.speakerName || '?'}: ${l.text}`)
    .join('\n');
}

const LABELS = {
  ja: {
    title: '会議録',
    when: '日時',
    room: '場所',
    caller: '呼んだ人',
    people: '参加者',
    highlights: 'ポイント',
    summary: '要約',
    video: '録画',
    transcript: '文字起こし',
    none: '（なし）',
    sep: '、',
  },
  en: {
    title: 'Meeting notes',
    when: 'When',
    room: 'Where',
    caller: 'Called by',
    people: 'Participants',
    highlights: 'Highlights',
    summary: 'Summary',
    video: 'Recording',
    transcript: 'Transcript',
    none: '(none)',
    sep: ', ',
  },
} as const;

// The summary document's text. `links` are added when the files live somewhere
// the reader can follow them to (Drive).
export function summaryDocText(
  m: MeetingRecord,
  s: Summary,
  opts: { tz: string; lang: 'ja' | 'en'; links?: { video?: string; transcript?: string } },
): string {
  const L = LABELS[opts.lang];
  const when = `${dateOf(m.startedAt, opts.tz)} ${timeOf(m.startedAt, opts.tz)}–${timeOf(m.endedAt, opts.tz)}`;
  const out = [
    `${L.title}: ${m.roomName ?? m.callerName}`,
    '',
    `${L.when}: ${when}`,
    ...(m.roomName ? [`${L.room}: ${m.roomName}`] : []),
    `${L.caller}: ${m.callerName}`,
    `${L.people}: ${m.participants.join(L.sep) || L.none}`,
    '',
    `■ ${L.highlights}`,
    ...(s.highlights.length ? s.highlights.map((h) => `・${h}`) : [L.none]),
    '',
    `■ ${L.summary}`,
    s.body || L.none,
  ];
  if (opts.links?.video || opts.links?.transcript) {
    out.push('');
    if (opts.links.video) out.push(`${L.video}: ${opts.links.video}`);
    if (opts.links.transcript) out.push(`${L.transcript}: ${opts.links.transcript}`);
  }
  return `${out.join('\n')}\n`;
}

// The short note sent with the share notification: when, where, takeaways.
export function notificationText(
  m: MeetingRecord,
  s: Summary,
  opts: { tz: string; lang: 'ja' | 'en' },
): string {
  const when = `${dateOf(m.startedAt, opts.tz)} ${timeOf(m.startedAt, opts.tz)}–${timeOf(m.endedAt, opts.tz)}`;
  const head = [when, m.roomName].filter(Boolean).join(' ');
  const people = m.participants.length ? ` (${m.participants.join(LABELS[opts.lang].sep)})` : '';
  const text = [`${head}${people}`, ...s.highlights.map((h) => `・${h}`)].join('\n');
  // Keep the email note short; the full summary is in the folder.
  return text.length > 900 ? `${text.slice(0, 897)}...` : text;
}
