import { describe, expect, it } from 'bun:test';
import { domainAllowed, parseRecipients, resolveRecipient } from '@/deliver/recipients';

describe('recipients', () => {
  const r = parseRecipients({
    'Alice Ｓ': 'alice@example.com',
    Mallory: 'mallory@evil.test',
    Bad: 3,
  });

  it('matches names ignoring case and full-width forms', () => {
    expect(resolveRecipient('alice s', r, ['example.com'])).toEqual({
      ok: true,
      email: 'alice@example.com',
    });
  });

  it('refuses unknown names and addresses outside the allowed domains', () => {
    expect(resolveRecipient('Bob', r, ['example.com'])).toEqual({
      ok: false,
      reason: 'unknown-name',
    });
    expect(resolveRecipient('Mallory', r, ['example.com'])).toEqual({
      ok: false,
      reason: 'domain-not-allowed',
    });
    expect(resolveRecipient('Bad', r, ['example.com'])).toEqual({
      ok: false,
      reason: 'unknown-name',
    });
  });

  it('never allows anything when no domain is configured', () => {
    expect(resolveRecipient('Alice S', r, [])).toEqual({ ok: false, reason: 'domain-not-allowed' });
  });

  it('checks the domain after the last @', () => {
    expect(domainAllowed('a@EXAMPLE.com', ['example.com'])).toBe(true);
    expect(domainAllowed('a@example.com@evil.test', ['example.com'])).toBe(false);
    expect(domainAllowed('example.com', ['example.com'])).toBe(false);
  });

  it('rejects a file that is not an object', () => {
    expect(() => parseRecipients(['a'])).toThrow();
  });
});
