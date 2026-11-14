// Google service-account auth without the Google SDK: sign a JWT with the
// account's private key (WebCrypto, RS256) and swap it for an access token.
// https://developers.google.com/identity/protocols/oauth2/service-account

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

export type ServiceAccount = { client_email: string; private_key: string };

export function parseServiceAccount(json: unknown): ServiceAccount {
  const v = json as Partial<ServiceAccount> | null;
  if (!v || typeof v.client_email !== 'string' || typeof v.private_key !== 'string') {
    throw new Error('service account file needs client_email and private_key');
  }
  return { client_email: v.client_email, private_key: v.private_key };
}

export function base64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function pemToDer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const bytes = Buffer.from(b64, 'base64');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

// The unsigned "header.claims" part of the assertion (pure, for tests).
export function jwtSigningInput(sa: ServiceAccount, scope: string, nowSec: number): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = { iss: sa.client_email, scope, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
}

export async function signJwt(sa: ServiceAccount, scope: string, nowSec: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const input = jwtSigningInput(sa, scope, nowSec);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${base64url(new Uint8Array(sig))}`;
}

// Caches the access token until shortly before it expires.
export class GoogleAuth {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly sa: ServiceAccount,
    private readonly scope = DRIVE_SCOPE,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async accessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && this.token.expiresAt - 60_000 > now) return this.token.value;
    const assertion = await signJwt(this.sa, this.scope, Math.floor(now / 1000));
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!res.ok)
      throw new Error(
        `Google token request failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`,
      );
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: now + json.expires_in * 1000 };
    return json.access_token;
  }
}
