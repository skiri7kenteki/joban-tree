// 段階19（v0.43.0）：稽古（通し稽古と間隔反復。持ち主の判断 2026-11-24「おすすめの通りで」）
// - タブは 定跡帳／稽古／実戦／設定（#/reviews は稽古へ）
// - 研究手順を出発点から通して指す：相手の手はアプリ、まちがえたら正解を盤で指して続く → 終わり（まちがい 1 → 明日）→ もう一度で全部正解（3 日後）
// - 実戦で違う手を指した研究手順が、今日の稽古のいちばん上に来る
// - 定跡帳の集計・★ の行の［稽古］・グループの ⋯ の［稽古］
// - 稽古の画面も 1 画面に収める
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true });

const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
/** 後手番。出発点（16 手目 △3三角）の後、自分の手は 18 手目 △6二玉・20 手目 △7二銀・22 手目 △6四歩 */
const A: Study = { id: 's-a', name: '青野流 △6二玉型', note: '△6二玉から銀を上がる', moves: [...G1, '5i5h', '5a6b', '3g3f', '7a7b', '2i3g', '6c6d'], mySide: 'white', createdAt: 2, updatedAt: 2 };
/** 18 手目 △5二玉 の研究 */
const B: Study = { id: 's-b', name: '青野流 △5二玉', note: '', moves: [...G1, '5i5h', '5a5b', '3g3f'], mySide: 'white', createdAt: 1, updatedAt: 1 };

async function setup(page: Page, studies: Study[]) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
  });
  await expect(page.getByTestId('study-item')).toHaveCount(studies.length);
}

/** 盤で指す（51 → 62 のように筋と段） */
async function play(page: Page, from: string, to: string) {
  await page.locator(`[data-testid="practice-board"] [data-square="${from}"]`).click();
  await page.locator(`[data-testid="practice-board"] [data-square="${to}"]`).click();
}

async function waitAsk(page: Page, ply: number) {
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
  await expect(page.getByTestId('practice-position')).toContainText(`${ply}手目`);
}

test('タブは 定跡帳／稽古／実戦／設定。#/reviews は稽古へ', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await expect(page.locator('.tabbar-label')).toHaveText(['定跡帳', '稽古', '実戦', '設定']);
  await page.getByTestId('tab-practice').click();
  await expect(page.getByTestId('practice-empty')).toBeVisible();
  await page.goto('./#/reviews');
  await expect(page.getByTestId('tab-practice')).toHaveAttribute('aria-current', 'page');
});

test('通して指す：まちがえたら正解を指して続く → 明日。もう一度、全部正解なら 3 日後', async ({ page }) => {
  await setup(page, [A]);
  await page.getByTestId('tab-practice').click();
  await expect(page.getByTestId('practice-item')).toHaveCount(1);
  await expect(page.getByTestId('practice-item')).toHaveAttribute('data-reason', 'new');
  await page.getByTestId('practice-start').click();

  // 出発点（16 手目）から：相手の ▲5八玉 をアプリが指して、18 手目を答える
  await expect(page.getByTestId('practice-title')).toContainText('青野流 △6二玉型');
  await waitAsk(page, 17);
  await expect(page.getByTestId('practice-pip')).toHaveCount(3);
  await play(page, '51', '52');
  await expect(page.getByTestId('practice-wrong')).toContainText('５二玉 ではありません');
  await expect(page.getByTestId('practice-answer')).toContainText('６二玉');
  await play(page, '51', '62');
  await waitAsk(page, 19);
  await play(page, '71', '72');
  await waitAsk(page, 21);
  await play(page, '63', '64');

  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'end');
  await expect(page.getByTestId('practice-end')).toContainText('18手目');
  await expect(page.getByTestId('practice-end')).toContainText('次は明日');
  await expect(page.locator('.practice-step.on')).toHaveText('明日');
  await expect(page.locator('[data-testid="practice-pip"].ng')).toHaveCount(1);
  await expect(page.locator('[data-testid="practice-pip"].ok')).toHaveCount(2);
  // 終わった後は、さかのぼって見られる
  await page.getByTestId('practice-prev').click();
  await expect(page.getByTestId('practice-position')).toContainText('21手目');
  await page.getByTestId('practice-next').click();

  // 稽古のタブ：今日は終わり。「これから」に明日
  await expect(page.getByTestId('practice-start')).toBeDisabled();
  await expect(page.getByTestId('practice-later-item')).toContainText('明日');
  await expect(page.getByTestId('practice-summary-wrong')).toContainText('1');

  // 前倒しでもう一度：全部正解なら 3 日後
  await page.getByTestId('practice-later-item').click();
  await waitAsk(page, 17);
  await play(page, '51', '62');
  await waitAsk(page, 19);
  await play(page, '71', '72');
  await waitAsk(page, 21);
  await play(page, '63', '64');
  await expect(page.getByTestId('practice-end')).toContainText('全部正解。次は 3日後');
  await expect(page.locator('.practice-step.on')).toHaveText('3日');
});

test('実戦で違う手を指した研究手順が、今日の稽古のいちばん上', async ({ page }) => {
  await setup(page, [A, B]);
  // 18 手目に △4二玉 を指した実戦（研究は △6二玉〔A、いちばん最近直した〕と △5二玉〔B〕）
  const lines = ['７六歩(77)', '３四歩(33)', '２六歩(27)', '８四歩(83)', '２五歩(26)', '８五歩(84)', '７八金(69)', '３二金(41)', '２四歩(25)', '２四歩(23)',
    '２四飛(28)', '８六歩(85)', '８六歩(87)', '８六飛(82)', '３四飛(24)', '３三角(22)', '５八玉(59)', '４二玉(51)'];
  const kif = ['開始日時：2026/11/20 10:00:00', '手合割：平手', '先手：sente_user', '後手：gote_user', '手数----指手---------消費時間--',
    ...lines.map((m, i) => `${i + 1} ${m}`), `${lines.length + 1} 投了`].join('\n');
  await page.goto('./#/games');
  await page.getByTestId('games-paste').click();
  await page.getByTestId('games-paste-text').fill(kif);
  await page.getByTestId('games-paste-side-white').click();
  await page.getByTestId('games-paste-ok').click();
  await expect(page.getByTestId('game-kind')).toHaveAttribute('data-kind', 'mine');
  await expect(page.getByTestId('game-result')).toContainText('稽古で先に出します');

  await page.goto('./#/practice');
  await expect(page.getByTestId('practice-item')).toHaveCount(2);
  await expect(page.getByTestId('practice-item').first()).toHaveAttribute('data-reason', 'game');
  await expect(page.getByTestId('practice-item').first()).toContainText('青野流 △6二玉型');
  await expect(page.getByTestId('practice-item').first()).toContainText('実戦で違う手（11/20）');
});

test('定跡帳：集計・★ の行の［稽古］・グループの ⋯ の［稽古］', async ({ page }) => {
  await setup(page, [A, B]);
  await page.reload();
  await expect(page.getByTestId('book-summary-today')).toContainText('2');
  await expect(page.getByTestId('book-summary-learned')).toContainText('0');
  // ★ の行の［稽古］：その 1 本
  await page.getByTestId('study-item').first().click();
  await page.getByTestId('book-head-review').click();
  await expect(page.getByTestId('practice-title')).toContainText('稽古 1／1本');
  await page.getByTestId('practice-back').click();
  // グループの ⋯ の［稽古］：グループの研究手順を続けて
  await page.goto('./');
  await page.getByTestId('study-group-menu-open').first().click();
  await page.getByTestId('study-group-review').click();
  await expect(page.getByTestId('practice-title')).toContainText('稽古 1／2本');
});

for (const [w, h] of [
  [360, 640],
  [390, 844],
  [1180, 820],
] as [number, number][]) {
  test(`${w}×${h}：稽古の画面はページ全体がスクロールしない`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page, [A]);
    await page.goto(`./#/practice/play/${A.id}`);
    await waitAsk(page, 17);
    await page.waitForTimeout(300);
    const el = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, client: document.scrollingElement!.clientHeight }));
    expect(el.scroll).toBeLessThanOrEqual(el.client);
    const bar = (await page.getByTestId('practice-nav').boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(h);
    if (w < h) {
      const card = (await page.getByTestId('practice-card').boundingBox())!;
      expect(card.y).toBeLessThan(h);
    }
  });
}
