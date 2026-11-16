// ホーム画面用のアイコン（public/*.png、scripts/make-icons.mjs で icon.svg から作る）を確かめる（v0.12.5）。
// PNG の大きさと、四隅の色（背景色 #f6f1e6。maskable 版の外側に前のアイコンの青い縁が残っていないか）を見る。
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';

const publicDir = new URL('../../public/', import.meta.url);
const BACKGROUND = [0xf6, 0xf1, 0xe6];

/** PNG の幅・高さと、画素の並び（フィルタを戻したもの）を読む（8 ビットの RGB か RGBA だけ） */
function readPng(name: string) {
  const buf = readFileSync(new URL(name, publicDir));
  expect(buf.subarray(0, 8).toString('hex'), `${name} は PNG`).toBe('89504e470d0a1a0a');
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('ascii');
    const data = buf.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8], `${name} は 8 ビット`).toBe(8);
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      expect(channels, `${name} は RGB か RGBA`).toBeGreaterThan(0);
    } else if (type === 'IDAT') {
      idat.push(data);
    }
    pos += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][filter];
      pixels[y * stride + x] = (v + pred) & 0xff;
    }
  }
  const pixel = (x: number, y: number) => [...pixels.subarray(y * stride + x * channels, y * stride + x * channels + 3)];
  return { width, height, pixel };
}

describe('ホーム画面用のアイコン', () => {
  for (const [name, size] of [
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['apple-touch-icon.png', 180],
    ['maskable-512.png', 512],
  ] as const) {
    test(`${name}：${size}×${size}、四隅は背景色（青い縁が無い）`, () => {
      const png = readPng(name);
      expect([png.width, png.height]).toEqual([size, size]);
      for (const [x, y] of [
        [0, 0],
        [size - 1, 0],
        [0, size - 1],
        [size - 1, size - 1],
      ]) {
        png.pixel(x, y).forEach((v, i) => expect(Math.abs(v - BACKGROUND[i]), `${name} (${x},${y})`).toBeLessThanOrEqual(2));
      }
    });
  }

  test('manifest のアイコンの大きさが PNG と合っている。起動画面の地はアイコンの背景色', () => {
    const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', publicDir), 'utf8')) as {
      background_color: string;
      icons: { src: string; sizes: string }[];
    };
    for (const icon of manifest.icons) {
      const png = readPng(icon.src);
      expect(icon.sizes).toBe(`${png.width}x${png.height}`);
    }
    expect(manifest.background_color).toBe('#f6f1e6');
  });
});
