// Hand a finished meeting over: summarize it, then put the recording, summary
// and transcript somewhere people can reach them — a local folder, or a Google
// Drive shared drive with the folder shared to the person who called the bot.
// If Drive fails, everything falls back to the local folder so nothing is lost.

import { mkdir, rename, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Drive } from '@/deliver/drive';
import { type Recipients, resolveRecipient } from '@/deliver/recipients';
import { log } from '@/log';
import {
  folderName,
  type MeetingRecord,
  monthOf,
  notificationText,
  type Summary,
  summaryDocText,
  transcriptText,
} from '@/meeting/record';

export type DeliverOptions = { tz: string; lang: 'ja' | 'en' };

const FILE_NAMES = {
  ja: { video: '録画', summary: '要約', transcript: '文字起こし' },
  en: { video: 'Recording', summary: 'Summary', transcript: 'Transcript' },
} as const;

export function videoMime(path: string): string {
  return extname(path).toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4';
}

// Write everything into <dir>/<folder name>/. Moves the recording in.
export async function deliverLocal(
  m: MeetingRecord,
  s: Summary,
  dir: string,
  o: DeliverOptions,
): Promise<string> {
  const names = FILE_NAMES[o.lang];
  const out = join(dir, folderName(m, o.tz));
  await mkdir(out, { recursive: true });
  if (m.videoPath) await rename(m.videoPath, join(out, `${names.video}${extname(m.videoPath)}`));
  await Bun.write(join(out, `${names.summary}.txt`), summaryDocText(m, s, o));
  await Bun.write(join(out, `${names.transcript}.txt`), `${transcriptText(m.lines, o.tz)}\n`);
  return out;
}

export async function deliverDrive(
  m: MeetingRecord,
  s: Summary,
  deps: { drive: Drive; rootFolderId: string; recipients: Recipients; allowedDomains: string[] },
  o: DeliverOptions,
): Promise<void> {
  const names = FILE_NAMES[o.lang];
  const { drive } = deps;
  const month = await drive.ensureFolder(monthOf(m.startedAt, o.tz), deps.rootFolderId);
  const folder = await drive.createFolder(folderName(m, o.tz), month.id);
  const video = m.videoPath
    ? await drive.uploadFile(
        m.videoPath,
        `${names.video}${extname(m.videoPath)}`,
        videoMime(m.videoPath),
        folder.id,
      )
    : null;
  const transcript = await drive.createDoc(
    names.transcript,
    transcriptText(m.lines, o.tz),
    folder.id,
  );
  const summary = await drive.createDoc(
    names.summary,
    summaryDocText(m, s, {
      ...o,
      links: { video: video?.webViewLink, transcript: transcript.webViewLink },
    }),
    folder.id,
  );
  log.info(`uploaded to Drive: ${folder.webViewLink}`);

  const who = resolveRecipient(m.callerName, deps.recipients, deps.allowedDomains);
  if (!who.ok) {
    log.warn(
      `not sharing with "${m.callerName}": ${who.reason} (the folder stays in the shared drive)`,
    );
  } else {
    const note = notificationText(m, s, o);
    try {
      await drive.shareWith(folder.id, who.email, note);
    } catch (err) {
      // Some organizations do not allow sharing folders inside a shared drive;
      // the summary doc links to the other two files, so share that instead.
      log.warn(`sharing the folder failed, sharing the summary doc instead: ${String(err)}`);
      await drive.shareWith(summary.id, who.email, note);
    }
    log.info(`shared with ${m.callerName}`);
  }
  if (m.videoPath) await rm(m.videoPath, { force: true });
}
