// The few Google Drive v3 calls the bot needs, over plain fetch. Everything is
// created inside a shared drive (a service account has no storage of its own),
// so every call carries supportsAllDrives.

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const DOC = 'application/vnd.google-apps.document';

export type DriveFile = { id: string; webViewLink: string };

// Drive query string literal: backslash and single quote are escaped.
export function qString(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export class Drive {
  constructor(
    private readonly token: () => Promise<string>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${await this.token()}`);
    const res = await this.fetchImpl(url, { ...init, headers });
    if (!res.ok)
      throw new Error(
        `Drive ${init.method ?? 'GET'} ${url.split('?')[0]} failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`,
      );
    return res;
  }

  // The folder `name` directly under `parentId`, created if missing.
  async ensureFolder(name: string, parentId: string): Promise<DriveFile> {
    const q = `name = ${qString(name)} and mimeType = '${FOLDER}' and ${qString(parentId)} in parents and trashed = false`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id,webViewLink)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      corpora: 'allDrives',
    });
    const found = (await (await this.call(`${API}?${params}`)).json()) as { files?: DriveFile[] };
    const existing = found.files?.[0];
    if (existing) return existing;
    return this.createFolder(name, parentId);
  }

  async createFolder(name: string, parentId: string): Promise<DriveFile> {
    const res = await this.call(`${API}?supportsAllDrives=true&fields=id,webViewLink`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
    });
    return (await res.json()) as DriveFile;
  }

  // A Google Doc made from plain text (Drive converts it on upload).
  async createDoc(name: string, text: string, parentId: string): Promise<DriveFile> {
    const boundary = `engawa-bot-${crypto.randomUUID()}`;
    const meta = JSON.stringify({ name, mimeType: DOC, parents: [parentId] });
    const body =
      `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
      `--${boundary}\r\ncontent-type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
    const res = await this.call(
      `${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`,
      {
        method: 'POST',
        headers: { 'content-type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    return (await res.json()) as DriveFile;
  }

  // Upload a (large) local file with a resumable session.
  async uploadFile(
    path: string,
    name: string,
    mimeType: string,
    parentId: string,
  ): Promise<DriveFile> {
    const file = Bun.file(path);
    const start = await this.call(
      `${UPLOAD}?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=UTF-8',
          'x-upload-content-type': mimeType,
          'x-upload-content-length': String(file.size),
        },
        body: JSON.stringify({ name, parents: [parentId] }),
      },
    );
    const session = start.headers.get('location');
    if (!session) throw new Error('Drive did not return a resumable upload URL');
    const res = await this.call(session, {
      method: 'PUT',
      headers: { 'content-type': mimeType, 'content-length': String(file.size) },
      body: file,
    });
    return (await res.json()) as DriveFile;
  }

  // Give `email` edit access; Drive emails them a notification with `message`.
  async shareWith(fileId: string, email: string, message: string): Promise<void> {
    const params = new URLSearchParams({
      supportsAllDrives: 'true',
      sendNotificationEmail: 'true',
      emailMessage: message,
    });
    await this.call(`${API}/${encodeURIComponent(fileId)}/permissions?${params}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
    });
  }
}
