// The slice of engawa's WebSocket protocol the bot reads. The bot never sends
// frames itself — the engawa client in the browser does — it only watches the
// traffic (both directions) to know where everyone is and what is happening.
// Mirrors engawa/server/src/types.ts; only the fields used here are typed.

export type PlayerInfo = { userId: string; name: string; x: number; y: number };

// Frames the server sends to the client.
export type InFrame =
  | { type: 'welcome'; self: PlayerInfo; players: PlayerInfo[] }
  | { type: 'player-joined'; player: PlayerInfo }
  | { type: 'player-moved'; userId: string; x: number; y: number }
  | { type: 'player-left'; userId: string }
  | { type: 'knock'; from: string; name: string }
  | { type: 'group-update'; members: string[] }
  | { type: 'transcript'; speakerId: string; speakerName: string; text: string; at: number }
  | { type: 'player-transcribing'; userId: string; transcribing: boolean };

// Frames the client sends to the server.
export type OutFrame =
  | { type: 'move'; x: number; y: number; zoneId: string | null }
  | { type: 'transcript'; speakerId: string; text: string; at: number }
  | { type: 'transcribing'; transcribing: boolean }
  | { type: 'recording'; recording: boolean }
  | { type: 'status'; isMuted: boolean; isVideoOn: boolean };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function parsePlayer(v: unknown): PlayerInfo | null {
  if (!isObj(v) || !isStr(v.userId) || !isStr(v.name) || !isNum(v.x) || !isNum(v.y)) return null;
  return { userId: v.userId, name: v.name, x: v.x, y: v.y };
}

function parseJson(payload: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(payload);
    return isObj(v) && isStr(v.type) ? v : null;
  } catch {
    return null;
  }
}

// Parse a received frame. Unknown or malformed frames come back null.
export function parseInFrame(payload: string): InFrame | null {
  const m = parseJson(payload);
  if (!m) return null;
  switch (m.type) {
    case 'welcome': {
      const self = parsePlayer(m.self);
      if (!self || !Array.isArray(m.players)) return null;
      const players = m.players.map(parsePlayer).filter((p): p is PlayerInfo => p !== null);
      return { type: 'welcome', self, players };
    }
    case 'player-joined': {
      const player = parsePlayer(m.player);
      return player ? { type: 'player-joined', player } : null;
    }
    case 'player-moved':
      return isStr(m.userId) && isNum(m.x) && isNum(m.y)
        ? { type: 'player-moved', userId: m.userId, x: m.x, y: m.y }
        : null;
    case 'player-left':
      return isStr(m.userId) ? { type: 'player-left', userId: m.userId } : null;
    case 'knock':
      return isStr(m.from) && isStr(m.name) ? { type: 'knock', from: m.from, name: m.name } : null;
    case 'group-update':
      return Array.isArray(m.members) && m.members.every(isStr)
        ? { type: 'group-update', members: m.members as string[] }
        : null;
    case 'transcript':
      return isStr(m.speakerId) && isStr(m.speakerName) && isStr(m.text) && isNum(m.at)
        ? {
            type: 'transcript',
            speakerId: m.speakerId,
            speakerName: m.speakerName,
            text: m.text,
            at: m.at,
          }
        : null;
    case 'player-transcribing':
      return isStr(m.userId) && typeof m.transcribing === 'boolean'
        ? { type: 'player-transcribing', userId: m.userId, transcribing: m.transcribing }
        : null;
    default:
      return null;
  }
}

// Parse a sent frame. Unknown or malformed frames come back null.
export function parseOutFrame(payload: string): OutFrame | null {
  const m = parseJson(payload);
  if (!m) return null;
  switch (m.type) {
    case 'move':
      return isNum(m.x) && isNum(m.y)
        ? { type: 'move', x: m.x, y: m.y, zoneId: isStr(m.zoneId) ? m.zoneId : null }
        : null;
    case 'transcript':
      return isStr(m.speakerId) && isStr(m.text) && isNum(m.at)
        ? { type: 'transcript', speakerId: m.speakerId, text: m.text, at: m.at }
        : null;
    case 'transcribing':
      return typeof m.transcribing === 'boolean'
        ? { type: 'transcribing', transcribing: m.transcribing }
        : null;
    case 'recording':
      return typeof m.recording === 'boolean'
        ? { type: 'recording', recording: m.recording }
        : null;
    case 'status':
      return typeof m.isMuted === 'boolean' && typeof m.isVideoOn === 'boolean'
        ? { type: 'status', isMuted: m.isMuted, isVideoOn: m.isVideoOn }
        : null;
    default:
      return null;
  }
}
