// アプリそのもの：ホーム画面に追加するための manifest・アイコン・名前
import { expect, test } from '@playwright/test';

test('ホーム画面に追加するための manifest とアイコンがある', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/joban-tree/manifest.webmanifest');
  const manifest = await (await request.get(href!)).json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    const res = await request.get(`/joban-tree/${icon.src}`);
    expect(res.ok()).toBe(true);
  }
  // v0.12.5：新しいアイコン（クリーム色の地に芽）。ブラウザのタブのアイコンも同じ icon.svg
  expect(manifest.background_color).toBe('#f6f1e6');
  const tabIcon = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(tabIcon).toBe('/joban-tree/icon.svg');
  const svg = await (await request.get(tabIcon!)).text();
  expect(svg).toContain('fill="#f6f1e6"');
  expect(svg).not.toContain('#2f5d8a');
  // v0.29.0：表示名は「将棋定跡帳」（URL・保存場所・ファイルの app は joban-tree のまま）
  expect(manifest.name).toBe('将棋定跡帳');
  expect(manifest.short_name).toBe('将棋定跡帳');
  await expect(page).toHaveTitle('将棋定跡帳');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', '将棋定跡帳');
  // v0.29.0：一覧の絞り込みの欄はやめた
  await expect(page.locator('input[type="search"]')).toHaveCount(0);
});
