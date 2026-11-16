// public/icon.svg から、ホーム画面用の PNG アイコンを作る（手元で 1 回だけ実行し、PNG をリポジトリに入れる）。
// 使い方：node scripts/make-icons.mjs （Playwright の Chromium を使う。初回は npx playwright install chromium）
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const svg = readFileSync(`${publicDir}icon.svg`, 'utf8');

// [ファイル名, 大きさ(px), 余白の割合]。maskable は端末が丸く切り抜くので、絵を小さめにする
const outputs = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
  ['maskable-512.png', 512, 0.12],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of outputs) {
  const inner = Math.round(size * (1 - pad * 2));
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:#f6f1e6;display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">` +
      svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `) +
      '</body></html>',
  );
  await page.screenshot({ path: `${publicDir}${name}`, omitBackground: false });
  console.log(`作成: public/${name}`);
}
await browser.close();
