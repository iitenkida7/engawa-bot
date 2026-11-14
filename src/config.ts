// Settings, read from the environment (see .env.example). Parsing is pure so the
// rules are unit-testable; main.ts passes in process.env.

import { tileCenter } from '@/bot/stroll';
import { parseOutfit } from '@/engawa/look';
import type { Point } from '@/engawa/world';

export type Delivery = 'local' | 'drive';

export type Config = {
  engawaUrl: string;
  engawaPassword: string | null;
  botName: string;
  groqApiKey: string;
  summaryModel: string;
  summaryLang: 'ja' | 'en';
  // IANA time zone for folder names and transcript timestamps.
  timeZone: string;
  // Waypoints for idle strolls and where to return after a meeting (world px).
  strollPoints: Point[];
  homePoint: Point | null;
  strollMinMs: number;
  strollMaxMs: number;
  maxMeetingMs: number;
  delivery: Delivery;
  dataDir: string;
  // Extra Chrome switches (e.g. --no-sandbox inside Docker).
  chromeFlags: string[];
  // The bot's look: a profile picture file (null = the built-in robot) and an
  // avatar outfit (null = the built-in one).
  avatarImageFile: string | null;
  outfit: Record<string, number> | null;
  // Google Drive (delivery = drive).
  serviceAccountFile: string;
  driveFolderId: string | null;
  // Who gets the meeting shared with them (by engawa display name).
  recipientsFile: string;
  allowedEmailDomains: string[];
};

type Env = Record<string, string | undefined>;

export class ConfigError extends Error {}

const str = (env: Env, key: string): string | null => {
  const v = env[key]?.trim();
  return v ? v : null;
};

function minutes(env: Env, key: string, fallback: number, errors: string[]): number {
  const raw = str(env, key);
  if (raw === null) return fallback * 60_000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    errors.push(`${key} must be a positive number of minutes`);
    return fallback * 60_000;
  }
  return n * 60_000;
}

// "c,r" tile coordinates, several separated by ";" (e.g. "40,8;44,9").
export function parsePoints(raw: string | null): Point[] | null {
  if (raw === null) return [];
  const out: Point[] = [];
  for (const part of raw.split(';')) {
    if (!part.trim()) continue;
    const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(part);
    if (!m) return null;
    out.push(tileCenter(Number(m[1]), Number(m[2])));
  }
  return out;
}

export function parseConfig(env: Env): Config {
  const errors: string[] = [];

  const engawaUrl = str(env, 'ENGAWA_URL');
  if (!engawaUrl) errors.push('ENGAWA_URL is required');
  else if (!/^https?:\/\//.test(engawaUrl))
    errors.push('ENGAWA_URL must start with http:// or https://');

  const groqApiKey = str(env, 'GROQ_API_KEY');
  if (!groqApiKey) errors.push('GROQ_API_KEY is required (transcription and summary)');

  const lang = str(env, 'SUMMARY_LANG') ?? 'ja';
  if (lang !== 'ja' && lang !== 'en') errors.push('SUMMARY_LANG must be ja or en');

  const timeZone = str(env, 'TIMEZONE') ?? 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    errors.push(`TIMEZONE is not a valid IANA time zone: ${timeZone}`);
  }

  const strollPoints = parsePoints(str(env, 'STROLL_POINTS'));
  if (strollPoints === null) errors.push('STROLL_POINTS must look like "c,r;c,r"');
  const home = parsePoints(str(env, 'HOME_POINT'));
  if (home === null || home.length > 1) errors.push('HOME_POINT must look like "c,r"');

  const strollMinMs = minutes(env, 'STROLL_MIN_MINUTES', 5, errors);
  const strollMaxMs = minutes(env, 'STROLL_MAX_MINUTES', 10, errors);
  if (strollMaxMs < strollMinMs) errors.push('STROLL_MAX_MINUTES must be >= STROLL_MIN_MINUTES');

  const maxMeetingMs = minutes(env, 'MAX_MEETING_MINUTES', 180, errors);

  const delivery = str(env, 'DELIVERY') ?? 'local';
  if (delivery !== 'local' && delivery !== 'drive') errors.push('DELIVERY must be local or drive');
  const driveFolderId = str(env, 'DRIVE_FOLDER_ID');
  if (delivery === 'drive' && !driveFolderId)
    errors.push('DRIVE_FOLDER_ID is required when DELIVERY=drive');

  const outfitRaw = str(env, 'BOT_OUTFIT');
  const outfit = outfitRaw === null ? null : parseOutfit(outfitRaw);
  if (outfitRaw !== null && outfit === null) {
    errors.push('BOT_OUTFIT must be a JSON object of non-negative integers');
  }

  const allowedEmailDomains = (str(env, 'ALLOWED_EMAIL_DOMAINS') ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);

  if (errors.length > 0) throw new ConfigError(errors.join('\n'));

  const points = strollPoints ?? [];
  return {
    engawaUrl: engawaUrl!,
    engawaPassword: str(env, 'ENGAWA_PASSWORD'),
    botName: str(env, 'BOT_NAME') ?? 'engawa-bot',
    groqApiKey: groqApiKey!,
    summaryModel: str(env, 'GROQ_SUMMARY_MODEL') ?? 'openai/gpt-oss-120b',
    summaryLang: lang as 'ja' | 'en',
    timeZone,
    strollPoints: points,
    homePoint: home?.[0] ?? points[0] ?? null,
    strollMinMs,
    strollMaxMs,
    maxMeetingMs,
    delivery: delivery as Delivery,
    dataDir: str(env, 'DATA_DIR') ?? './data',
    chromeFlags: (str(env, 'CHROME_FLAGS') ?? '').split(/\s+/).filter(Boolean),
    avatarImageFile: str(env, 'BOT_AVATAR_IMAGE'),
    outfit,
    serviceAccountFile: str(env, 'GOOGLE_SERVICE_ACCOUNT_FILE') ?? './config/service-account.json',
    driveFolderId,
    recipientsFile: str(env, 'RECIPIENTS_FILE') ?? './config/recipients.json',
    allowedEmailDomains,
  };
}
