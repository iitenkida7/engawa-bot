// What the bot knows about the office, rebuilt purely from the WebSocket
// traffic it observes (see protocol.ts). No I/O here, so it is unit-testable by
// feeding frames in.

import type { InFrame, OutFrame, PlayerInfo } from '@/engawa/protocol';

export type Point = { x: number; y: number };

export type TranscriptLine = { at: number; speakerId: string; speakerName: string; text: string };

export type WorldEvent =
  | { type: 'knock'; from: string; name: string }
  | { type: 'group'; members: string[] };

export class World {
  myId: string | null = null;
  myPos: Point | null = null;
  myZoneId: string | null = null;
  // Everyone else, by userId.
  players = new Map<string, PlayerInfo>();
  // The server-decided call group we are in (ourselves included); empty when alone.
  group: string[] = [];
  // Peers currently transcribing (their lines reach us as `transcript` frames).
  transcribingPeers = new Set<string>();
  // Whether our own client is transcribing / recording, as it told the server.
  transcribing = false;
  recording = false;
  // Our own mic/camera as last announced (the bot keeps both off).
  micOn = false;
  camOn = false;
  // Transcript lines seen since the last `takeTranscript()`.
  private lines: TranscriptLine[] = [];

  // Apply a received frame. Returns an event for the bot when it needs to react.
  applyIn(f: InFrame): WorldEvent | null {
    switch (f.type) {
      case 'welcome':
        this.myId = f.self.userId;
        this.myPos = { x: f.self.x, y: f.self.y };
        this.players.clear();
        for (const p of f.players) if (p.userId !== f.self.userId) this.players.set(p.userId, p);
        return null;
      case 'player-joined':
        if (f.player.userId !== this.myId) this.players.set(f.player.userId, f.player);
        return null;
      case 'player-moved': {
        const p = this.players.get(f.userId);
        if (p) this.players.set(f.userId, { ...p, x: f.x, y: f.y });
        return null;
      }
      case 'player-left':
        this.players.delete(f.userId);
        this.transcribingPeers.delete(f.userId);
        return null;
      case 'knock':
        return { type: 'knock', from: f.from, name: f.name };
      case 'group-update':
        this.group = f.members;
        return { type: 'group', members: f.members };
      case 'transcript':
        this.lines.push({
          at: f.at,
          speakerId: f.speakerId,
          speakerName: f.speakerName,
          text: f.text,
        });
        return null;
      case 'player-transcribing':
        if (f.transcribing) this.transcribingPeers.add(f.userId);
        else this.transcribingPeers.delete(f.userId);
        return null;
    }
  }

  // Apply a frame our own client sent.
  applyOut(f: OutFrame): void {
    switch (f.type) {
      case 'move':
        this.myPos = { x: f.x, y: f.y };
        this.myZoneId = f.zoneId;
        return;
      case 'transcript':
        // Our client transcribes everyone in the call; the server fills in the
        // speaker's name only for the copies it relays, so resolve it here.
        this.lines.push({
          at: f.at,
          speakerId: f.speakerId,
          speakerName: this.nameOf(f.speakerId),
          text: f.text,
        });
        return;
      case 'transcribing':
        this.transcribing = f.transcribing;
        return;
      case 'recording':
        this.recording = f.recording;
        return;
      case 'status':
        this.micOn = !f.isMuted;
        this.camOn = f.isVideoOn;
        return;
    }
  }

  nameOf(userId: string): string {
    return this.players.get(userId)?.name ?? '';
  }

  // Whether someone else in our call is already transcribing it (a second run
  // would duplicate every line, and engawa refuses to start one anyway).
  someoneElseTranscribing(): boolean {
    return this.group.some((id) => id !== this.myId && this.transcribingPeers.has(id));
  }

  // Hand over (and forget) the transcript lines collected so far.
  takeTranscript(): TranscriptLine[] {
    const out = this.lines;
    this.lines = [];
    return out;
  }
}
