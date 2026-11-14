// Entry point: read the config, open the engawa client and run the bot.
// Any fatal error exits non-zero; Docker's restart policy brings it back.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Bot } from '@/bot/bot';
import { DEFAULT_LIMITS } from '@/bot/session';
import { ConfigError, parseConfig } from '@/config';
import { deliverDrive, deliverLocal } from '@/deliver/deliver';
import { Drive } from '@/deliver/drive';
import { GoogleAuth, parseServiceAccount } from '@/deliver/google-auth';
import { parseRecipients, type Recipients } from '@/deliver/recipients';
import { EngawaClient } from '@/engawa/client';
import { DEFAULT_OUTFIT, fileDataUrl, ROBOT_SVG, svgDataUrl } from '@/engawa/look';
import { log } from '@/log';
import type { MeetingRecord } from '@/meeting/record';
import { summarize } from '@/meeting/summarize';

async function readJson(path: string): Promise<unknown | null> {
  const f = Bun.file(path);
  return (await f.exists()) ? f.json() : null;
}

async function main(): Promise<void> {
  const config = parseConfig(process.env);
  const downloads = join(config.dataDir, 'downloads');
  const outDir = join(config.dataDir, 'meetings');
  await mkdir(downloads, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const recipientsJson = await readJson(config.recipientsFile);
  const recipients: Recipients = recipientsJson ? parseRecipients(recipientsJson) : {};
  let drive: Drive | null = null;
  if (config.delivery === 'drive') {
    const sa = await readJson(config.serviceAccountFile);
    if (!sa) throw new ConfigError(`service account file not found: ${config.serviceAccountFile}`);
    const auth = new GoogleAuth(parseServiceAccount(sa));
    drive = new Drive(() => auth.accessToken());
  }
  const o = { tz: config.timeZone, lang: config.summaryLang };

  const onMeeting = async (m: MeetingRecord) => {
    const summary = await summarize(m, {
      apiKey: config.groqApiKey,
      model: config.summaryModel,
      ...o,
    }).catch((err) => {
      log.error('summary failed:', err);
      return { highlights: [], body: '' };
    });
    if (drive && config.driveFolderId) {
      try {
        await deliverDrive(
          m,
          summary,
          {
            drive,
            rootFolderId: config.driveFolderId,
            recipients,
            allowedDomains: config.allowedEmailDomains,
          },
          o,
        );
        return;
      } catch (err) {
        log.error('Drive delivery failed, keeping the meeting locally:', err);
      }
    }
    const dir = await deliverLocal(m, summary, outDir, o);
    log.info(`meeting saved to ${dir}`);
  };

  let avatarImage = svgDataUrl(ROBOT_SVG);
  if (config.avatarImageFile) {
    const bytes = await Bun.file(config.avatarImageFile).bytes();
    const url = fileDataUrl(config.avatarImageFile, bytes);
    if (!url) throw new ConfigError(`BOT_AVATAR_IMAGE must be a png, jpg, webp, gif or svg file`);
    avatarImage = url;
  }

  let bot: Bot | null = null;
  const client = new EngawaClient({
    url: config.engawaUrl,
    password: config.engawaPassword,
    name: config.botName,
    groqApiKey: config.groqApiKey,
    downloadDir: downloads,
    chromeFlags: config.chromeFlags,
    look: { image: avatarImage, outfit: { ...DEFAULT_OUTFIT, ...config.outfit } },
    onEvent: (e) => bot?.onWorldEvent(e),
  });
  bot = new Bot(client, {
    strollPoints: config.strollPoints,
    homePoint: config.homePoint,
    strollMinMs: config.strollMinMs,
    strollMaxMs: config.strollMaxMs,
    limits: { ...DEFAULT_LIMITS, maxMeetingMs: config.maxMeetingMs },
    lang: config.summaryLang,
    onMeeting,
  });

  const shutdown = () => {
    log.info('shutting down');
    bot?.stop();
    client.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await client.start();
  await bot.run();
}

main().catch((err) => {
  if (err instanceof ConfigError) log.error(`config error:\n${err.message}`);
  else log.error('fatal:', err);
  process.exit(1);
});
