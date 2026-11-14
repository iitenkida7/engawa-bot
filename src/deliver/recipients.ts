// Who the meeting is shared with: the person who called the bot, looked up by
// their engawa display name in a JSON file kept next to the bot (engawa itself
// knows no email addresses). Only addresses on an allowed domain are used, so a
// typo or a stray entry can never share a recording outside the organization.

export type Recipients = Record<string, string>;

// Parse recipients.json: { "Display name": "address@example.com", ... }.
export function parseRecipients(json: unknown): Recipients {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error('recipients file must be a JSON object of "display name": "email"');
  }
  const out: Recipients = {};
  for (const [name, email] of Object.entries(json)) {
    if (typeof email === 'string' && name.trim()) out[normalizeName(name)] = email.trim();
  }
  return out;
}

// engawa names are free text; match them case- and width-insensitively.
export function normalizeName(name: string): string {
  return name.normalize('NFKC').trim().toLowerCase();
}

export function domainAllowed(email: string, allowed: string[]): boolean {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return allowed.includes(domain);
}

export type Resolution =
  | { ok: true; email: string }
  | { ok: false; reason: 'unknown-name' | 'domain-not-allowed' };

export function resolveRecipient(
  name: string,
  recipients: Recipients,
  allowedDomains: string[],
): Resolution {
  const email = recipients[normalizeName(name)];
  if (!email) return { ok: false, reason: 'unknown-name' };
  if (!domainAllowed(email, allowedDomains)) return { ok: false, reason: 'domain-not-allowed' };
  return { ok: true, email };
}
