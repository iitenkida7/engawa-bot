import { describe, expect, it } from 'bun:test';
import { fileDataUrl, parseOutfit, ROBOT_SVG, svgDataUrl, thumbnailScript } from '@/engawa/look';

describe('bot look', () => {
  it('encodes the built-in robot as an SVG data URL', () => {
    const url = svgDataUrl(ROBOT_SVG);
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(Buffer.from(url.split(',')[1]!, 'base64').toString()).toBe(ROBOT_SVG);
  });

  it('builds data URLs for known image types only', () => {
    expect(fileDataUrl('a/b.PNG', new Uint8Array([1, 2]))).toBe('data:image/png;base64,AQI=');
    expect(fileDataUrl('x.jpeg', new Uint8Array([1]))?.startsWith('data:image/jpeg;base64,')).toBe(
      true,
    );
    expect(fileDataUrl('x.bmp', new Uint8Array([1]))).toBeNull();
  });

  it('parses BOT_OUTFIT and rejects anything but non-negative integers', () => {
    expect(parseOutfit('{"hat":2,"glasses":0}')).toEqual({ hat: 2, glasses: 0 });
    expect(parseOutfit('{"hat":-1}')).toBeNull();
    expect(parseOutfit('{"hat":1.5}')).toBeNull();
    expect(parseOutfit('[1]')).toBeNull();
    expect(parseOutfit('nope')).toBeNull();
  });

  it('embeds the source safely in the thumbnail script', () => {
    expect(thumbnailScript('data:x"y')).toContain('img.src = "data:x\\"y"');
  });
});
