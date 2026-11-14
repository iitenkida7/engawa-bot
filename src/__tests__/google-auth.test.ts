import { describe, expect, it } from 'bun:test';
import {
  base64url,
  GoogleAuth,
  jwtSigningInput,
  parseServiceAccount,
  signJwt,
} from '@/deliver/google-auth';

async function testAccount() {
  const pair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString(
    'base64',
  );
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  return {
    sa: { client_email: 'bot@project.iam.gserviceaccount.com', private_key: pem },
    publicKey: pair.publicKey,
  };
}

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

describe('google auth', () => {
  it('builds the claim set', () => {
    const [h, c] = jwtSigningInput({ client_email: 'x@y', private_key: '' }, 'scope', 100).split(
      '.',
    );
    expect(JSON.parse(fromB64url(h!).toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(fromB64url(c!).toString())).toEqual({
      iss: 'x@y',
      scope: 'scope',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 100,
      exp: 3700,
    });
  });

  it('signs a JWT that verifies with the public key', async () => {
    const { sa, publicKey } = await testAccount();
    const jwt = await signJwt(sa, 'scope', 100);
    const [h, c, s] = jwt.split('.');
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      fromB64url(s!),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  it('exchanges the assertion for a token and caches it', async () => {
    const { sa } = await testAccount();
    let calls = 0;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      calls++;
      expect(String(init.body)).toContain('grant_type=urn');
      return Response.json({ access_token: 'tok', expires_in: 3600 });
    }) as unknown as typeof fetch;
    const auth = new GoogleAuth(sa, 'scope', fakeFetch);
    expect(await auth.accessToken()).toBe('tok');
    expect(await auth.accessToken()).toBe('tok');
    expect(calls).toBe(1);
  });

  it('validates the service account file and encodes base64url', () => {
    expect(() => parseServiceAccount({ client_email: 'x' })).toThrow();
    expect(base64url(new Uint8Array([251, 255]))).toBe('-_8');
  });
});
