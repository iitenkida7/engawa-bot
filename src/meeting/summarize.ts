// Meeting summary with a Groq-hosted LLM (OpenAI-compatible chat API), using the
// same Groq key as the transcription. Prompt building and response parsing are
// pure and unit-tested; `summarize` only adds the HTTP call.

import type { MeetingRecord, Summary } from '@/meeting/record';
import { transcriptText } from '@/meeting/record';

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

// A long meeting is cut to fit the model's context window (roughly one token
// per Japanese character). The tail is kept: decisions tend to come last.
export const MAX_TRANSCRIPT_CHARS = 80_000;

export function clipTranscript(text: string, max = MAX_TRANSCRIPT_CHARS): string {
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.4);
  return `${text.slice(0, head)}\n...\n${text.slice(text.length - (max - head))}`;
}

const INSTRUCTIONS = {
  ja: `あなたは会議の書記です。以下の会議の文字起こしを読み、日本語で要約してください。
出力は次の形の JSON だけにしてください:
{"highlights": ["要点1", "要点2", "要点3"], "summary": "要約本文"}
- highlights: 決まったこと・宿題（担当者がわかれば名前）・次の予定を中心に、1 行ずつ最大 5 個。
- summary: 議題ごとに「- 」で始まる箇条書きの本文。文字起こしに無いことは書かない。
- 文字起こしは音声認識なので誤字があります。文脈から自然に補ってください。`,
  en: `You are a meeting scribe. Read the meeting transcript below and summarize it in English.
Reply with JSON only, shaped as:
{"highlights": ["point 1", "point 2", "point 3"], "summary": "summary text"}
- highlights: up to 5 one-liners, focusing on decisions, action items (with owners when known) and next steps.
- summary: the body, as "- " bullets grouped by topic. Do not add anything that is not in the transcript.
- The transcript comes from speech recognition and contains errors; read it charitably.`,
} as const;

export function buildMessages(
  m: MeetingRecord,
  opts: { tz: string; lang: 'ja' | 'en' },
): { role: 'system' | 'user'; content: string }[] {
  const meta = [
    m.roomName ? `Room: ${m.roomName}` : null,
    `Participants: ${m.participants.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n');
  return [
    { role: 'system', content: INSTRUCTIONS[opts.lang] },
    { role: 'user', content: `${meta}\n\n${clipTranscript(transcriptText(m.lines, opts.tz))}` },
  ];
}

// Pull a Summary out of the model's reply. Tolerates a fenced code block or
// prose around the JSON; falls back to the raw text as the body.
export function parseSummary(content: string): Summary {
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const v = JSON.parse(content.slice(start, end + 1)) as {
        highlights?: unknown;
        summary?: unknown;
      };
      const highlights = Array.isArray(v.highlights)
        ? v.highlights
            .filter((h): h is string => typeof h === 'string' && h.trim() !== '')
            .map((h) => h.trim())
        : [];
      const body = typeof v.summary === 'string' ? v.summary.trim() : '';
      if (highlights.length || body) return { highlights: highlights.slice(0, 5), body };
    } catch {
      // fall through
    }
  }
  return { highlights: [], body: content.trim() };
}

export async function summarize(
  m: MeetingRecord,
  opts: { apiKey: string; model: string; tz: string; lang: 'ja' | 'en'; fetch?: typeof fetch },
): Promise<Summary> {
  if (m.lines.length === 0) return { highlights: [], body: '' };
  const res = await (opts.fetch ?? fetch)(GROQ_CHAT_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: buildMessages(m, opts),
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok)
    throw new Error(`Groq summary failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return parseSummary(json.choices?.[0]?.message?.content ?? '');
}
