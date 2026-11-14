import { describe, expect, it } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Drive, qString } from '@/deliver/drive';

type Call = { url: string; method: string; headers: Headers; body: unknown };

function fakeDrive(responses: Response[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: new Headers(init.headers),
      body: init.body,
    });
    const r = responses.shift();
    if (!r) throw new Error(`unexpected request ${url}`);
    return r;
  }) as unknown as typeof fetch;
  return { drive: new Drive(async () => 'tok', fetchImpl), calls };
}

describe('Drive', () => {
  it('escapes query strings', () => {
    expect(qString("it's a \\ test")).toBe("'it\\'s a \\\\ test'");
  });

  it('reuses an existing folder', async () => {
    const { drive, calls } = fakeDrive([
      Response.json({ files: [{ id: 'f1', webViewLink: 'L' }] }),
    ]);
    expect(await drive.ensureFolder('2026-11', 'root')).toEqual({ id: 'f1', webViewLink: 'L' });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('q')).toContain("name = '2026-11'");
    expect(url.searchParams.get('supportsAllDrives')).toBe('true');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer tok');
  });

  it('creates the folder when missing', async () => {
    const { drive, calls } = fakeDrive([
      Response.json({ files: [] }),
      Response.json({ id: 'new', webViewLink: 'L' }),
    ]);
    expect((await drive.ensureFolder('x', 'root')).id).toBe('new');
    expect(calls[1]!.method).toBe('POST');
    expect(JSON.parse(String(calls[1]!.body))).toEqual({
      name: 'x',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['root'],
    });
  });

  it('creates a Google Doc from text with a multipart upload', async () => {
    const { drive, calls } = fakeDrive([Response.json({ id: 'd', webViewLink: 'L' })]);
    await drive.createDoc('Summary', 'こんにちは', 'p');
    const body = String(calls[0]!.body);
    expect(calls[0]!.url).toContain('uploadType=multipart');
    expect(calls[0]!.headers.get('content-type')).toStartWith('multipart/related; boundary=');
    expect(body).toContain('"mimeType":"application/vnd.google-apps.document"');
    expect(body).toContain('こんにちは');
  });

  it('uploads a file through a resumable session', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'engawa-bot-')), 'rec.mp4');
    await Bun.write(path, 'video-bytes');
    const { drive, calls } = fakeDrive([
      new Response(null, { status: 200, headers: { location: 'https://upload.example/session' } }),
      Response.json({ id: 'v', webViewLink: 'L' }),
    ]);
    expect(await drive.uploadFile(path, 'rec.mp4', 'video/mp4', 'p')).toEqual({
      id: 'v',
      webViewLink: 'L',
    });
    expect(calls[0]!.headers.get('x-upload-content-length')).toBe('11');
    expect(calls[1]!.url).toBe('https://upload.example/session');
    expect(calls[1]!.method).toBe('PUT');
  });

  it('shares with a notification message', async () => {
    const { drive, calls } = fakeDrive([Response.json({ id: 'perm' })]);
    await drive.shareWith('f', 'a@example.com', 'hello');
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toEndWith('/files/f/permissions');
    expect(url.searchParams.get('emailMessage')).toBe('hello');
    expect(url.searchParams.get('sendNotificationEmail')).toBe('true');
    expect(JSON.parse(String(calls[0]!.body))).toEqual({
      type: 'user',
      role: 'writer',
      emailAddress: 'a@example.com',
    });
  });

  it('surfaces HTTP errors', async () => {
    const { drive } = fakeDrive([new Response('denied', { status: 403 })]);
    await expect(drive.shareWith('f', 'a@b', 'm')).rejects.toThrow('403');
  });
});
