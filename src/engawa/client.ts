// Drives the real engawa web client in a headless Chrome (Bun.WebView). The bot
// is an ordinary participant: it logs in, walks and presses the same toolbar
// buttons a person would, so nothing on the engawa side has to know about it.
// It "sees" by reading the client's own WebSocket traffic over the DevTools
// Protocol (see protocol.ts / world.ts).

import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MAX_PROFILE_IMAGE_LEN,
  OUTFIT_KEY,
  PROFILE_IMAGE_KEY,
  thumbnailScript,
} from '@/engawa/look';
import { parseInFrame, parseOutFrame } from '@/engawa/protocol';
import { type Point, World, type WorldEvent } from '@/engawa/world';
import { log } from '@/log';

// engawa keeps the user's Groq key here (engawa/client/src/media/groq.ts).
const GROQ_KEY_STORAGE = 'engawa-groq-key';

const CHROME_ARGS = [
  // Answer permission prompts without a dialog. No fake capture devices on
  // purpose: with nothing to capture, the bot's mic and camera cannot turn on
  // (a fake device would broadcast a test beep into the meeting).
  '--use-fake-ui-for-media-stream',
  // Remote audio must play (unmuted <audio>) for recording and transcription.
  '--autoplay-policy=no-user-gesture-required',
  '--window-size=1600,900',
  '--lang=ja-JP',
];

type CdpFrameEvent = Event & { data: { response: { payloadData: string } } };

export class EngawaClient {
  readonly world = new World();
  private view: Bun.WebView | null = null;
  private lastFrameAt = Date.now();
  // Files already in the download dir, so a new recording can be told apart.
  private knownDownloads = new Set<string>();

  constructor(
    private readonly opts: {
      url: string;
      password: string | null;
      name: string;
      groqApiKey: string;
      downloadDir: string;
      chromeFlags?: string[];
      // Profile picture source (any image data URL) and avatar outfit.
      look: { image: string; outfit: Record<string, number> };
      onEvent: (e: WorldEvent) => void;
    },
  ) {}

  // Milliseconds since the client last exchanged a frame with the server (the
  // client pings every few seconds, so a long silence means it is wedged).
  get silenceMs(): number {
    return Date.now() - this.lastFrameAt;
  }

  async start(): Promise<void> {
    const view = new Bun.WebView({
      backend: { type: 'chrome', argv: [...CHROME_ARGS, ...(this.opts.chromeFlags ?? [])] },
      console: (type: string, ...args: unknown[]) => {
        if (type === 'error') log.debug('page error:', ...args.map(describe));
      },
    });
    this.view = view;
    // CDP needs a page session first.
    await view.navigate('about:blank');
    await view.cdp('Network.enable');
    view.addEventListener('Network.webSocketFrameReceived', (e) => {
      this.lastFrameAt = Date.now();
      const f = parseInFrame((e as CdpFrameEvent).data.response.payloadData);
      if (!f) return;
      const ev = this.world.applyIn(f);
      if (ev) this.opts.onEvent(ev);
    });
    view.addEventListener('Network.webSocketFrameSent', (e) => {
      this.lastFrameAt = Date.now();
      const f = parseOutFrame((e as CdpFrameEvent).data.response.payloadData);
      if (f) this.world.applyOut(f);
    });
    await view.cdp('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: this.opts.downloadDir,
    });
    this.knownDownloads = new Set(await readdir(this.opts.downloadDir).catch(() => []));
    await this.join();
  }

  close(): void {
    this.view?.close();
    this.view = null;
  }

  private get v(): Bun.WebView {
    if (!this.view) throw new Error('engawa client not started');
    return this.view;
  }

  private async join(): Promise<void> {
    const v = this.v;
    // The Groq key lives in the page's localStorage, so seed it on the origin
    // before the app boots (it is read when transcription starts).
    await v.navigate(this.opts.url);
    await v.evaluate(
      `localStorage.setItem(${JSON.stringify(GROQ_KEY_STORAGE)}, ${JSON.stringify(this.opts.groqApiKey)})`,
    );
    await this.seedLook();
    await v.reload();
    if (await this.visible('#join-pass-form')) {
      if (!this.opts.password)
        throw new Error('engawa asks for a password but ENGAWA_PASSWORD is not set');
      await v.click('#join-password');
      await v.type(this.opts.password);
      await v.press('Enter');
      await this.waitFor(() => this.visible('#join-form'), 15_000, 'password was not accepted');
    }
    await v.click('#join-name');
    await v.evaluate(`document.getElementById('join-name').value = ''`);
    await v.type(this.opts.name);
    await v.press('Enter');
    await this.waitFor(
      async () => this.world.myId !== null,
      20_000,
      'never got a welcome from engawa',
    );
    log.info(`joined as ${this.opts.name} (${this.world.myId})`);
    // Hide our own (always camera-off) tile. engawa's recorder only composites
    // tiles that are on screen, so this also keeps the bot out of the
    // recording instead of taking up a gallery slot.
    await v.evaluate(`(() => {
      const s = document.createElement('style');
      s.textContent = '#self-preview { display: none !important; }';
      document.head.appendChild(s);
    })()`);
  }

  // Store the bot's profile picture and outfit where engawa keeps the user's
  // own, so the client picks them up on join.
  private async seedLook(): Promise<void> {
    const v = this.v;
    const { image, outfit } = this.opts.look;
    try {
      const png = await v.evaluate<string>(thumbnailScript(image));
      if (png.length <= MAX_PROFILE_IMAGE_LEN) {
        await v.evaluate(
          `localStorage.setItem(${JSON.stringify(PROFILE_IMAGE_KEY)}, ${JSON.stringify(png)})`,
        );
      } else {
        log.warn('the bot avatar image is too large for engawa; skipping it');
      }
    } catch (err) {
      log.warn(`could not set the bot avatar image: ${String(err)}`);
    }
    await v.evaluate(
      `localStorage.setItem(${JSON.stringify(OUTFIT_KEY)}, ${JSON.stringify(JSON.stringify(outfit))})`,
    );
  }

  // The bot must never send audio or video of its own. Called every tick: the
  // client can switch the mic on asynchronously after joining.
  async ensureMediaOff(): Promise<void> {
    if (this.world.micOn) {
      log.warn('mic was on; turning it off');
      await this.clickById('btn-mic');
    }
    if (this.world.camOn) {
      log.warn('camera was on; turning it off');
      await this.clickById('btn-cam');
    }
  }

  // Answer the knock toast from `name`: accept (engawa then walks us over to
  // them) or "later" (they get a polite "tied up" note).
  async answerKnock(name: string, accept: boolean): Promise<boolean> {
    const found = await this.v.evaluate<boolean>(`(() => {
      const toast = [...document.querySelectorAll('.toast')].find(
        (t) => t.querySelector('.toast-actions') && t.textContent.includes(${JSON.stringify(name)}));
      const btn = toast && toast.querySelector(${JSON.stringify(accept ? '.toast-actions button.primary' : '.toast-actions button:not(.primary)')});
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    if (!found) log.warn(`knock toast from ${name} not found`);
    return found;
  }

  // Walk to a world point with engawa's own click-to-move (double-click, A*).
  // The double-click is dispatched on the map canvas directly, so it works
  // even while the meeting view covers the map. The camera is centered on us
  // at zoom 1 (the bot never zooms), so world offset == screen offset.
  async walkTo(target: Point): Promise<void> {
    const me = this.world.myPos;
    if (!me) return;
    log.debug(
      `walking from (${Math.round(me.x)}, ${Math.round(me.y)}) to (${target.x}, ${target.y})`,
    );
    const dx = target.x - me.x;
    const dy = target.y - me.y;
    await this.v.evaluate(`(() => {
      const c = document.getElementById('canvas');
      if (!c) return false;
      const r = c.getBoundingClientRect();
      c.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true, cancelable: true,
        clientX: r.left + r.width / 2 + ${dx}, clientY: r.top + r.height / 2 + ${dy},
      }));
      return true;
    })()`);
  }

  async setRecording(on: boolean): Promise<void> {
    if (this.world.recording !== on) await this.clickById('btn-rec');
  }

  async setTranscribing(on: boolean): Promise<void> {
    if (this.world.transcribing !== on) await this.clickById('btn-transcript');
  }

  // Wait for the recording that stopping just started to download, and return
  // its path. engawa saves it as a normal browser download.
  async waitForRecording(timeoutMs = 120_000): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    let lastSize = -1;
    while (Date.now() < deadline) {
      const files = (await readdir(this.opts.downloadDir).catch(() => [] as string[])).filter(
        (f) =>
          !this.knownDownloads.has(f) && !f.endsWith('.crdownload') && f.startsWith('recording-'),
      );
      const file = files.find((f) => !f.includes('-autosave')) ?? files[0];
      if (file) {
        const path = join(this.opts.downloadDir, file);
        const { size } = await stat(path);
        if (size > 0 && size === lastSize) {
          this.knownDownloads.add(file);
          return path;
        }
        lastSize = size;
      }
      await Bun.sleep(1000);
    }
    return null;
  }

  // Fetch a JSON resource from the engawa server (same origin as the page).
  async fetchJson<T>(path: string): Promise<T | null> {
    try {
      const res = await fetch(new URL(path, this.opts.url));
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  }

  // Click a toolbar button with a script click: it works whether or not the
  // meeting view has it laid out where a pointer could reach.
  private async clickById(id: string): Promise<void> {
    await this.v.evaluate(`document.getElementById(${JSON.stringify(id)})?.click()`);
  }

  private async visible(selector: string): Promise<boolean> {
    return this.v.evaluate<boolean>(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      return !!el && !el.classList.contains('hidden') && el.offsetParent !== null;
    })()`);
  }

  private async waitFor(
    cond: () => Promise<boolean>,
    timeoutMs: number,
    what: string,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await cond()) return;
      await Bun.sleep(250);
    }
    throw new Error(what);
  }
}

function describe(x: unknown): string {
  if (typeof x !== 'object' || x === null) return String(x);
  const d = (x as { description?: unknown }).description;
  return typeof d === 'string' ? d.split('\n')[0]! : JSON.stringify(x).slice(0, 200);
}
