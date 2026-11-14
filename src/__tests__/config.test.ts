import { describe, expect, it } from 'bun:test';
import { tileCenter } from '@/bot/stroll';
import { ConfigError, parseConfig, parsePoints } from '@/config';

const base = { ENGAWA_URL: 'https://engawa.example.com/', GROQ_API_KEY: 'gsk_x' };

describe('parseConfig', () => {
  it('applies defaults', () => {
    const c = parseConfig(base);
    expect(c.botName).toBe('engawa-bot');
    expect(c.delivery).toBe('local');
    expect(c.summaryLang).toBe('ja');
    expect(c.timeZone).toBe('UTC');
    expect(c.strollMinMs).toBe(5 * 60_000);
    expect(c.maxMeetingMs).toBe(180 * 60_000);
    expect(c.homePoint).toBeNull();
  });

  it('reports every problem at once', () => {
    let err: unknown;
    try {
      parseConfig({ DELIVERY: 'drive', SUMMARY_LANG: 'fr', TIMEZONE: 'Nowhere/City' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ConfigError);
    const msg = (err as Error).message;
    for (const key of [
      'ENGAWA_URL',
      'GROQ_API_KEY',
      'SUMMARY_LANG',
      'TIMEZONE',
      'DRIVE_FOLDER_ID',
    ]) {
      expect(msg).toContain(key);
    }
  });

  it('uses the first stroll point as home unless HOME_POINT is set', () => {
    expect(parseConfig({ ...base, STROLL_POINTS: '1,2;3,4' }).homePoint).toEqual(tileCenter(1, 2));
    expect(parseConfig({ ...base, STROLL_POINTS: '1,2', HOME_POINT: '9,9' }).homePoint).toEqual(
      tileCenter(9, 9),
    );
  });

  it('normalizes allowed email domains', () => {
    expect(
      parseConfig({ ...base, ALLOWED_EMAIL_DOMAINS: ' @Example.com, foo.org ,' })
        .allowedEmailDomains,
    ).toEqual(['example.com', 'foo.org']);
  });

  it('splits extra Chrome flags', () => {
    expect(parseConfig({ ...base, CHROME_FLAGS: ' --no-sandbox  --foo=1 ' }).chromeFlags).toEqual([
      '--no-sandbox',
      '--foo=1',
    ]);
    expect(parseConfig(base).chromeFlags).toEqual([]);
  });

  it('rejects stroll windows that end before they start', () => {
    expect(() =>
      parseConfig({ ...base, STROLL_MIN_MINUTES: '10', STROLL_MAX_MINUTES: '5' }),
    ).toThrow(ConfigError);
  });
});

describe('parsePoints', () => {
  it('parses tile lists and rejects junk', () => {
    expect(parsePoints('1,2; 3 , 4;')).toEqual([tileCenter(1, 2), tileCenter(3, 4)]);
    expect(parsePoints(null)).toEqual([]);
    expect(parsePoints('1;2')).toBeNull();
  });
});

describe('look settings', () => {
  const base = { ENGAWA_URL: 'https://engawa.example.com/', GROQ_API_KEY: 'gsk_x' };

  it('reads BOT_OUTFIT and BOT_AVATAR_IMAGE', () => {
    const c = parseConfig({ ...base, BOT_OUTFIT: '{"hat":2}', BOT_AVATAR_IMAGE: './me.png' });
    expect(c.outfit).toEqual({ hat: 2 });
    expect(c.avatarImageFile).toBe('./me.png');
    expect(parseConfig(base).outfit).toBeNull();
  });

  it('rejects a malformed BOT_OUTFIT', () => {
    expect(() => parseConfig({ ...base, BOT_OUTFIT: '{"hat":"x"}' })).toThrow(ConfigError);
  });
});
