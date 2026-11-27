// 段階26（持ち主の判断 2026-11-27）
// 26-1（v0.57.0）：稽古のタブを定跡帳ごとにまとめる
// - 「今日」「これから」とも定跡帳ごとの見出し。今日は初めは開き、これからは閉じる。開閉は覚える
// - 中は手順の近い順の 1 行 44px。行の文字は分かれ目（自分で付けた名前はそのまま）
// - 見出しの［まとめて稽古］は、その定跡帳の全部を手順の近い順に
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true, viewport: { width: 360, height: 740 } });

const BASE = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
const COMMON = [...BASE, '5i5h', '5a6b', '3g3f', '7a7b', '2i3g', '6c6d'];
const study = (id: string, name: string, moves: string[], updatedAt: number, mySide: Study['mySide'] = 'white'): Study => ({ id, name, note: '', moves, mySide, createdAt: updatedAt, updatedAt });
/** アプリが付ける名前のまま（行には分かれ目の文字が出る） */
const AUTO = '▲５八玉 … △６三銀';
const A = study('s-a', AUTO, [...COMMON, '3i4h', '7b6c'], 30);
const B = study('s-b', AUTO, [...COMMON, '3i3h', '7b6c'], 20);
/** 自分で付けた名前 */
const C = study('s-c', '△8二歩の形', [...BASE, '5i5h', '5a6b', '3g3f', 'P*8b', '3i3h', '7a7b'], 10);
/** 横歩取りではない（その他・先手番） */
const O = study('s-o', '▲７六歩 … ▲６八飛', ['7g7f', '3c3d', '6g6f', '8c8d', '2h6h'], 5, 'black');

async function setup(page: Page, studies: Study[]) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
  });
  await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${studies.length} 本`);
}

const groupsIn = (page: Page, list: 'practice-today' | 'practice-later') => page.getByTestId(list).getByTestId('practice-group');
const book = (page: Page, list: 'practice-today' | 'practice-later', name: string) => groupsIn(page, list).filter({ hasText: name });

test('今日は定跡帳ごとに開いた見出し。中は手順の近い順の 44px の行で、分かれ目の文字。開閉は覚える', async ({ page }) => {
  await setup(page, [C, O, B, A]);
  await page.getByTestId('tab-practice').click();
  await expect(groupsIn(page, 'practice-today')).toHaveCount(2);
  const yoko = book(page, 'practice-today', '横歩取り ☖後手');
  await expect(yoko.getByTestId('practice-group-meta')).toHaveText('身についた 0／3・今日 3本');
  // 手の多く集まる枝（A・B）が先。自分で付けた名前はそのまま
  await expect(yoko.locator('.practice-row-text')).toHaveText(['23手目 ▲４八銀 から △６三銀まで', '23手目 ▲３八銀 から △６三銀まで', '△8二歩の形']);
  if (process.env.SHOTS) await page.screenshot({ path: 'screenshots/360x740-practice-groups.png' });
  for (const row of await yoko.getByTestId('practice-item').all()) expect(Math.round((await row.boundingBox())!.height)).toBe(44);
  // 360px の幅で、横にはみ出さない
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= document.scrollingElement!.clientWidth)).toBe(true);
  expect((await yoko.getByTestId('practice-group-all').boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await yoko.getByTestId('practice-group-head').click();
  await expect(yoko.getByTestId('practice-item')).toHaveCount(0);
  await page.reload();
  await expect(yoko.getByTestId('practice-group-head')).toHaveAttribute('aria-expanded', 'false');
  await yoko.getByTestId('practice-group-head').click();
  await expect(yoko.getByTestId('practice-item')).toHaveCount(3);

  // 稽古の画面の見出しは、行と同じ文字
  await yoko.getByTestId('practice-item').first().click();
  await expect(page.getByTestId('practice-title')).toContainText('23手目 ▲４八銀 から △６三銀まで');
});

test('［まとめて稽古］はその定跡帳の全部を手順の近い順に。稽古した分は「これから」の閉じた見出しに入る', async ({ page }) => {
  await setup(page, [C, B, A]);
  await page.getByTestId('tab-practice').click();
  await page.getByTestId('practice-group-all').click();
  await expect(page.getByTestId('practice-title')).toContainText('稽古 1／3本');
  await expect(page.getByTestId('practice-title')).toContainText('▲４八銀');

  // 1 本目を指し切る
  for (const [ply, from, to] of [[17, '51', '62'], [19, '71', '72'], [21, '63', '64'], [23, '72', '63']] as const) {
    await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
    await expect(page.getByTestId('practice-position')).toContainText(`${ply}手目`);
    await page.locator(`[data-testid="practice-board"] [data-square="${from}"]`).click();
    await page.locator(`[data-testid="practice-board"] [data-square="${to}"]`).click();
  }
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'end');
  await page.getByTestId('practice-back').click();

  // 「これから」は閉じている。開くと行の右に次の稽古の日
  const later = book(page, 'practice-later', '横歩取り ☖後手');
  await expect(later.getByTestId('practice-group-head')).toHaveAttribute('aria-expanded', 'false');
  await expect(later.getByTestId('practice-group-meta')).toContainText('次は ');
  await expect(page.getByTestId('practice-later-item')).toHaveCount(0);
  await later.getByTestId('practice-group-head').click();
  await expect(page.getByTestId('practice-later-item')).toContainText('明日');
  // 見出しの［まとめて稽古］は「これから」からも定跡帳の全部
  await later.getByTestId('practice-group-all').click();
  await expect(page.getByTestId('practice-title')).toContainText('稽古 1／3本');
});
