// 段階26（持ち主の判断 2026-11-27）
// 26-1（v0.57.0）：稽古のタブを定跡帳ごとにまとめる
// - 「今日」「これから」とも定跡帳ごとの見出し。今日は初めは開き、これからは閉じる。開閉は覚える
// - 中は手順の近い順の 1 行 44px。行の文字は分かれ目（自分で付けた名前はそのまま）
// - 見出しの［まとめて稽古］は、その定跡帳の全部を手順の近い順に
// 26-2（v0.58.0）：同じ出だしの早送り
// - 続けて稽古すると、2 本目は分かれ目の 1 つ前の自分の手から。早送り中は盤で指せず、［とばす］。早送りした手は記録に数えない
// - 1 回目にまちがえた手・前回まちがえた手は早送りしない。1 本だけの稽古と、設定で切ったときは出発点から
// - 盤の大きさと位置は変わらない
import { openSettings } from './settings';
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

// ---- 26-2 ----

/** 自分（後手）が答える手：番目 → [元のます, 先のます]（A・B 共通） */
const ANSWERS: Record<number, [string, string]> = { 17: ['51', '62'], 19: ['71', '72'], 21: ['63', '64'], 23: ['72', '63'] };

async function tap(page: Page, from: string, to: string) {
  await page.locator(`[data-testid="practice-board"] [data-square="${from}"]`).click();
  await page.locator(`[data-testid="practice-board"] [data-square="${to}"]`).click();
}

async function waitAsk(page: Page, ply: number) {
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
  await expect(page.getByTestId('practice-position')).toContainText(`${ply}手目`);
}

/** from 番目から終わりまで正しく指す。wrongAt の所は、先に違う手を指す */
async function playFrom(page: Page, from: number, wrongAt?: number) {
  for (let ply = from; ply <= 23; ply += 2) {
    await waitAsk(page, ply);
    if (ply === wrongAt) {
      await tap(page, '93', '94');
      await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'wrong');
    }
    await tap(page, ...ANSWERS[ply]);
  }
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'end');
}

/** IndexedDB に保存された稽古の記録の、まちがいの数 */
const savedMistakes = (page: Page, studyId: string) =>
  page.evaluate(
    (id) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('joban-tree');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction('practice').objectStore('practice').get(id);
          get.onsuccess = () => {
            open.result.close();
            resolve(get.result.lastMistakes);
          };
        };
      }),
    studyId,
  );

const skipPips = (page: Page) => page.locator('[data-testid="practice-pip"].skip');
const board = (page: Page) => page.getByTestId('practice-board').boundingBox();

for (const [w, h] of [
  [360, 640],
  [390, 844],
  [1180, 820],
] as [number, number][]) {
  test(`${w}×${h}：2 本目は分かれ目の 1 つ前の自分の手から。早送りの前後で盤は変わらず、1 画面に収まる`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page, [B, A]);
    await page.goto('./#/practice');
    await page.getByTestId('practice-start').click();
    // その日の最初の 1 本は出発点から
    await expect(skipPips(page)).toHaveCount(0);
    await playFrom(page, 17);
    await page.getByTestId('practice-next').click();

    // 早送り中：盤で指せない・操作バーに［とばす］
    await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'skip');
    await expect(page.getByTestId('practice-card')).toContainText('22手目から、あなたが指します');
    await expect(page.getByTestId('practice-skip')).toBeVisible();
    await expect(skipPips(page)).toHaveCount(2);
    const during = await board(page);
    if (process.env.SHOTS) await page.screenshot({ path: `screenshots/${w}x${h}-practice-skip.png` });
    await tap(page, '93', '94');

    await waitAsk(page, 21);
    await expect(page.getByTestId('practice-skip-end')).toHaveText('ここから指します。');
    await expect(page.locator('[data-testid="practice-pip"].ng')).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await board(page)).toEqual(during);
    if (process.env.SHOTS) await page.screenshot({ path: `screenshots/${w}x${h}-practice-skip-end.png` });
    const el = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, client: document.scrollingElement!.clientHeight }));
    expect(el.scroll).toBeLessThanOrEqual(el.client);

    // 早送りした手は数えない：自分で指した 2 手が正解なら、全部正解
    await playFrom(page, 21);
    await expect(page.getByTestId('practice-end')).toContainText('全部正解');
    await expect(page.locator('[data-testid="practice-pip"].ok')).toHaveCount(2);
    await expect(skipPips(page)).toHaveCount(2);
    // 保存された記録と端末の覚えにも、早送りした手はまちがいとして入らない
    expect(await savedMistakes(page, 's-b')).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('joban-tree.practice-wrong'))).not.toContain('s-b');
  });
}

test('［とばす］ですぐ指し始める。行を押した 1 本だけの稽古は、出発点から', async ({ page }) => {
  await setup(page, [B, A]);
  await page.goto('./#/practice');
  await page.getByTestId('practice-group-all').click();
  await playFrom(page, 17);
  await page.getByTestId('practice-next').click();
  await page.getByTestId('practice-skip').click();
  await waitAsk(page, 21);

  await page.goto('./#/practice/play/s-b');
  await waitAsk(page, 17);
  await expect(skipPips(page)).toHaveCount(0);
});

test('1 回目にまちがえた手は早送りしない。次の日の分でなくても、前回まちがえた手の前から', async ({ page }) => {
  await setup(page, [B, A]);
  await page.goto('./#/practice');
  await page.getByTestId('practice-start').click();
  // 1 本目（A）で 20 手目（19 番目）をまちがえる → 2 本目（B）は、その 1 つ前の自分の手（17 番目）から
  await playFrom(page, 17, 19);
  await page.getByTestId('practice-next').click();
  await waitAsk(page, 17);
  await expect(skipPips(page)).toHaveCount(0);
  await playFrom(page, 17);

  // もう一度まとめて稽古：B で 19 番目を正しく指したので今日の分はそろったが、A は前回そこをまちがえたので、その前（17 番目）から
  await page.goto('./#/practice');
  await page.getByTestId('practice-later').getByTestId('practice-group-all').click();
  await waitAsk(page, 17);
});

test('前回まちがえた手が分からない（覚えが無い）研究手順は、早送りしない', async ({ page }) => {
  await setup(page, [B, A]);
  await page.goto('./#/practice/play/s-b');
  await playFrom(page, 17, 23);
  await page.evaluate(() => localStorage.removeItem('joban-tree.practice-wrong'));
  await page.goto('./#/practice/play/s-a');
  await playFrom(page, 17);
  await page.goto('./#/practice');
  // まとめて稽古：A（早送りできる）→ B（どこをまちがえたか分からないので出発点から）
  await page.getByTestId('practice-later').getByTestId('practice-group-all').click();
  await page.getByTestId('practice-skip').click();
  await playFrom(page, 23);
  await page.getByTestId('practice-next').click();
  await waitAsk(page, 17);
  await expect(skipPips(page)).toHaveCount(0);
});

test('設定で「しない」にすると、2 本目も出発点から', async ({ page }) => {
  await setup(page, [B, A]);
  await openSettings(page, 'practice');
  await expect(page.getByTestId('skip-same-on')).toHaveAttribute('aria-checked', 'true');
  if (process.env.SHOTS) {
    await page.getByTestId('skip-same-on').evaluate((e) => e.closest('section')!.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: 'screenshots/360x740-settings-practice.png' });
  }
  await page.getByTestId('skip-same-off').click();
  await page.reload();
  await expect(page.getByTestId('skip-same-off')).toHaveAttribute('aria-checked', 'true');
  await page.goto('./#/practice');
  await page.getByTestId('practice-start').click();
  await playFrom(page, 17);
  await page.getByTestId('practice-next').click();
  await waitAsk(page, 17);
  await expect(skipPips(page)).toHaveCount(0);
});
