// How the bot looks in engawa: a robot profile picture (shown on its camera-off
// tile, in the roster and by its name on the map) and a fixed avatar outfit, so
// people can tell it apart at a glance and it looks the same after a restart.
// Both are plain engawa settings kept in the page's localStorage.

// engawa's storage keys (engawa/client/src/ui/profile-image.ts, avatar-editor.ts).
export const PROFILE_IMAGE_KEY = 'engawa-profile-image';
export const OUTFIT_KEY = 'engawa-outfit';

// engawa relays profile pictures up to this many characters (MAX_AVATAR_IMAGE_LEN).
export const MAX_PROFILE_IMAGE_LEN = 64 * 1024;

// The default picture: an original robot face (part of this repository, MIT).
export const ROBOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<rect width="128" height="128" fill="#dcefed"/>
<line x1="64" y1="18" x2="64" y2="34" stroke="#2f4858" stroke-width="5" stroke-linecap="round"/>
<circle cx="64" cy="15" r="7" fill="#f2a541"/>
<rect x="16" y="56" width="10" height="24" rx="5" fill="#2f4858"/>
<rect x="102" y="56" width="10" height="24" rx="5" fill="#2f4858"/>
<rect x="24" y="34" width="80" height="68" rx="18" fill="#2a9d8f"/>
<rect x="34" y="46" width="60" height="36" rx="12" fill="#f4fbfa"/>
<circle cx="50" cy="63" r="7" fill="#2f4858"/>
<circle cx="78" cy="63" r="7" fill="#2f4858"/>
<circle cx="52" cy="61" r="2" fill="#fff"/>
<circle cx="80" cy="61" r="2" fill="#fff"/>
<path d="M54 90 Q64 97 74 90" stroke="#f4fbfa" stroke-width="5" fill="none" stroke-linecap="round"/>
</svg>`;

// A fixed outfit (indices into engawa's avatar parts; engawa clamps any index
// out of range). Hat and glasses make it stand out from a random newcomer.
export const DEFAULT_OUTFIT: Record<string, number> = {
  sex: 0,
  skin: 0,
  hair: 0,
  hairColor: 0,
  top: 0,
  topColor: 0,
  bottom: 0,
  bottomColor: 0,
  shoes: 0,
  hat: 1,
  glasses: 1,
};

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

// A data URL for an image file's bytes, or null for an unknown extension.
export function fileDataUrl(path: string, bytes: Uint8Array): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mime = MIME_BY_EXT[ext];
  return mime ? `data:${mime};base64,${Buffer.from(bytes).toString('base64')}` : null;
}

// Page-side script that redraws `src` as a 128px square PNG (like engawa's own
// profile picture upload does) and resolves to its data URL.
export function thumbnailScript(src: string): string {
  return `new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const s = Math.min(img.naturalWidth || 128, img.naturalHeight || 128);
      const sx = ((img.naturalWidth || 128) - s) / 2;
      const sy = ((img.naturalHeight || 128) - s) / 2;
      c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, 128, 128);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('could not decode the bot avatar image'));
    img.src = ${JSON.stringify(src)};
  })`;
}

// Parse BOT_OUTFIT: a JSON object of non-negative integer indices.
export function parseOutfit(raw: string): Record<string, number> | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v)) {
      if (!Number.isInteger(n) || (n as number) < 0) return null;
      out[k] = n as number;
    }
    return out;
  } catch {
    return null;
  }
}
