// The bot's main loop: feeds what the engawa client sees into the session state
// machine (session.ts), carries out the resulting actions in the browser, and
// strolls about while idle. One loop, one action at a time, so the browser is
// never driven from two places at once.

import {
  type Caller,
  type SessionAction,
  type SessionEvent,
  type SessionLimits,
  type SessionState,
  step,
} from '@/bot/session';
import { nextStrollDelay, pickStrollTarget } from '@/bot/stroll';
import type { EngawaClient } from '@/engawa/client';
import { type MapInfo, zoneName } from '@/engawa/map';
import type { Point, WorldEvent } from '@/engawa/world';
import { log } from '@/log';
import type { MeetingRecord } from '@/meeting/record';

const TICK_MS = 1000;
// Keep this far from people while strolling (world px; engawa connects calls
// at roughly 3 tiles).
const AVOID_RADIUS = 400;
// How often to retry starting transcription when it did not take (e.g. nobody
// had a mic on yet).
const TRANSCRIBE_RETRY_MS = 15_000;
// The client pings every few seconds; this long without traffic means the page
// is wedged. The process exits and Docker restarts it.
const MAX_SILENCE_MS = 120_000;
// How often to make sure our own mic and camera are off (a toggle click needs
// a moment to show up in the status we watch, so not every tick).
const MEDIA_CHECK_MS = 5_000;

export type BotOptions = {
  strollPoints: Point[];
  homePoint: Point | null;
  strollMinMs: number;
  strollMaxMs: number;
  limits: SessionLimits;
  lang: 'ja' | 'en';
  // Called with each finished meeting; runs in the background.
  onMeeting: (m: MeetingRecord) => Promise<void>;
};

export class Bot {
  private state: SessionState = { kind: 'idle' };
  private queue: SessionEvent[] = [];
  private map: MapInfo | null = null;
  private nextStrollAt = 0;
  private lastTranscribeTry = 0;
  private lastMediaCheck = 0;
  private roomZoneId: string | null = null;
  private stopped = false;

  constructor(
    private readonly client: EngawaClient,
    private readonly opts: BotOptions,
    private readonly rng: () => number = Math.random,
  ) {}

  // Hook for EngawaClient's onEvent.
  readonly onWorldEvent = (e: WorldEvent): void => {
    const myId = this.client.world.myId;
    if (e.type === 'knock') this.queue.push({ type: 'knock', from: e.from, name: e.name });
    else if (myId)
      this.queue.push({ type: 'group', members: e.members, myId, names: this.names() });
  };

  async run(): Promise<void> {
    this.map = await this.client.fetchJson<MapInfo>('/api/map');
    this.scheduleStroll(Date.now());
    if (this.opts.homePoint) await this.client.walkTo(this.opts.homePoint);
    while (!this.stopped) {
      const now = Date.now();
      if (this.client.silenceMs > MAX_SILENCE_MS) throw new Error('engawa client went silent');
      const events = this.queue.splice(0);
      for (const ev of [...events, { type: 'tick' } as const]) {
        const r = step(this.state, ev, now, this.opts.limits);
        if (r.state.kind !== this.state.kind) {
          const p = this.client.world.myPos;
          const at = p ? ` at (${Math.round(p.x)}, ${Math.round(p.y)})` : '';
          log.info(`state: ${this.state.kind} → ${r.state.kind}${at}`);
        }
        this.state = r.state;
        for (const a of r.actions) await this.perform(a);
      }
      await this.maintain(now);
      await Bun.sleep(TICK_MS);
    }
  }

  stop(): void {
    this.stopped = true;
  }

  private names(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, p] of this.client.world.players) out[id] = p.name;
    return out;
  }

  private async perform(a: SessionAction): Promise<void> {
    const { client } = this;
    switch (a.type) {
      case 'accept-knock':
        log.info(`knocked by ${a.name}: on my way`);
        await client.answerKnock(a.name, true);
        return;
      case 'decline-knock':
        log.info(`knocked by ${a.name} while busy: declining`);
        await client.answerKnock(a.name, false);
        return;
      case 'start-meeting':
        log.info('joined the call: recording and transcribing');
        client.world.takeTranscript(); // drop anything heard on the way
        this.roomZoneId = client.world.myZoneId;
        this.lastTranscribeTry = 0;
        await client.setRecording(true);
        return;
      case 'end-meeting':
        log.info(`meeting over (${a.reason})`);
        await this.finish(a.caller, a.startedAt, a.endedAt, a.participants);
        return;
      case 'give-up':
        log.warn(`never reached ${a.caller.name}; going home`);
        await this.goHome();
        return;
    }
  }

  // Per-tick upkeep for the current state.
  private async maintain(now: number): Promise<void> {
    const { client } = this;
    const w = client.world;
    if (now - this.lastMediaCheck >= MEDIA_CHECK_MS) {
      this.lastMediaCheck = now;
      await client.ensureMediaOff();
    }
    if (this.state.kind === 'meeting') {
      if (!w.recording) await client.setRecording(true);
      // engawa refuses a second transcription of the same call; if someone is
      // already transcribing, their lines reach us anyway.
      if (
        !w.transcribing &&
        !w.someoneElseTranscribing() &&
        now - this.lastTranscribeTry >= TRANSCRIBE_RETRY_MS
      ) {
        this.lastTranscribeTry = now;
        await client.setTranscribing(true);
      }
      return;
    }
    if (this.state.kind === 'idle' && now >= this.nextStrollAt) {
      this.scheduleStroll(now);
      const self = w.myPos;
      if (!self) return;
      const target = pickStrollTarget({
        points: this.opts.strollPoints,
        self,
        people: [...w.players.values()],
        avoidRadius: AVOID_RADIUS,
        rng: this.rng,
      });
      if (target) await client.walkTo(target);
    }
  }

  private scheduleStroll(now: number): void {
    this.nextStrollAt =
      now + nextStrollDelay(this.opts.strollMinMs, this.opts.strollMaxMs, this.rng);
  }

  private async goHome(): Promise<void> {
    if (this.opts.homePoint) await this.client.walkTo(this.opts.homePoint);
    this.scheduleStroll(Date.now());
  }

  private async finish(
    caller: Caller,
    startedAt: number,
    endedAt: number,
    participants: string[],
  ): Promise<void> {
    const { client } = this;
    await client.setTranscribing(false);
    await client.setRecording(false);
    const videoPath = await client.waitForRecording();
    if (!videoPath) log.warn('the recording never arrived');
    const record: MeetingRecord = {
      callerName: caller.name,
      participants,
      roomName: zoneName(this.map, this.roomZoneId, this.opts.lang),
      startedAt,
      endedAt,
      videoPath,
      lines: client.world.takeTranscript(),
    };
    await this.goHome();
    // Summarizing and uploading take a while; do it in the background so the
    // bot is available again right away.
    this.opts.onMeeting(record).catch((err) => log.error('delivering the meeting failed:', err));
  }
}
