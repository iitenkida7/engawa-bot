import { describe, expect, it } from 'bun:test';
import { exists, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliverDrive, deliverLocal, videoMime } from '@/deliver/deliver';
import type { Drive } from '@/deliver/drive';
import type { MeetingRecord } from '@/meeting/record';

const T0 = Date.UTC(2026, 10, 14, 5, 30, 0);
const summary = { highlights: ['decided A'], body: '- detail' };
const o = { tz: 'UTC', lang: 'en' as const };

async function meetingWithVideo(): Promise<MeetingRecord> {
  const dir = await mkdtemp(join(tmpdir(), 'engawa-bot-'));
  const videoPath = join(dir, 'recording-x.mp4');
  await Bun.write(videoPath, 'video');
  return {
    callerName: 'Alice',
    participants: ['Alice', 'Bob'],
    roomName: 'Room A',
    startedAt: T0,
    endedAt: T0 + 60_000,
    videoPath,
    lines: [{ at: T0, speakerId: 'a', speakerName: 'Alice', text: 'hi' }],
  };
}

// A Drive stand-in that records what was asked of it.
function fakeDrive(opts: { folderShareFails?: boolean } = {}) {
  const log: string[] = [];
  let n = 0;
  const file = () => ({ id: `id${++n}`, webViewLink: `https://drive/${n}` });
  const record = (line: string) => {
    log.push(line);
    return file();
  };
  const drive = {
    ensureFolder: async (name: string) => record(`ensure ${name}`),
    createFolder: async (name: string) => record(`folder ${name}`),
    uploadFile: async (_p: string, name: string, mime: string) => record(`upload ${name} ${mime}`),
    createDoc: async (name: string, text: string) => record(`doc ${name}: ${text.split('\n')[0]}`),
    shareWith: async (id: string, email: string) => {
      if (opts.folderShareFails && id === 'id2') throw new Error('403');
      log.push(`share ${id} ${email}`);
    },
  };
  return { drive: drive as unknown as Drive, log };
}

describe('deliverLocal', () => {
  it('moves the recording in and writes summary and transcript', async () => {
    const m = await meetingWithVideo();
    const out = await mkdtemp(join(tmpdir(), 'engawa-bot-out-'));
    const dir = await deliverLocal(m, summary, out, o);
    expect(dir).toBe(join(out, '2026-11-14 0530 Room A (Alice, Bob)'));
    expect((await readdir(dir)).sort()).toEqual(['Recording.mp4', 'Summary.txt', 'Transcript.txt']);
    expect(await exists(m.videoPath!)).toBe(false);
    expect(await Bun.file(join(dir, 'Transcript.txt')).text()).toContain('Alice: hi');
  });
});

describe('deliverDrive', () => {
  const deps = (drive: Drive) => ({
    drive,
    rootFolderId: 'root',
    recipients: { alice: 'alice@example.com' },
    allowedDomains: ['example.com'],
  });

  it('uploads into a month folder and shares the meeting folder with the caller', async () => {
    const m = await meetingWithVideo();
    const { drive, log } = fakeDrive();
    await deliverDrive(m, summary, deps(drive), o);
    expect(log).toEqual([
      'ensure 2026-11',
      'folder 2026-11-14 0530 Room A (Alice, Bob)',
      'upload Recording.mp4 video/mp4',
      'doc Transcript: [05:30:00] Alice: hi',
      'doc Summary: Meeting notes: Room A',
      'share id2 alice@example.com',
    ]);
    expect(await exists(m.videoPath!)).toBe(false);
  });

  it('falls back to sharing the summary doc when folder sharing is refused', async () => {
    const m = await meetingWithVideo();
    const { drive, log } = fakeDrive({ folderShareFails: true });
    await deliverDrive(m, summary, deps(drive), o);
    expect(log.at(-1)).toBe('share id5 alice@example.com');
  });

  it('uploads but does not share when the caller has no allowed address', async () => {
    const m = { ...(await meetingWithVideo()), callerName: 'Stranger' };
    const { drive, log } = fakeDrive();
    await deliverDrive(m, summary, deps(drive), o);
    expect(log.some((l) => l.startsWith('share'))).toBe(false);
  });

  it('picks the video MIME type from the extension', () => {
    expect(videoMime('a.webm')).toBe('video/webm');
    expect(videoMime('a.mp4')).toBe('video/mp4');
  });
});
