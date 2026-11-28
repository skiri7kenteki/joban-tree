// 段階21-2（v0.48.0）：悪手の咎め方を盤でたどる・稽古の次善と悪手。持ち主の判断 2026-11-25「全部おすすめの通りで」
// - 定跡帳：研究手順の無い悪手の行 → 盤で ‹ › →［戻る］で元の局面。研究手順は増えず、盤の大きさは変わらない
// - 稽古：次善はまちがいにしない。悪手はまちがいで、咎め方を自動で見せて戻り、正解を指すと続く
// - 食い違いの一覧で本命を選んだあと［取り消す］。局面メモの書きかけは窓を離れると保存する
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import type { Candidate } from '../src/tree/candidates';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true });

const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
/** 後手番。17手目 ▲5八玉 の後に △6二玉（A） */
const A: Study = { id: 's-a', name: '青野流 △6二玉型', note: '', moves: [...G1, '5i5h', '5a6b', '3g3f', '7a7b'], mySide: 'white', createdAt: 2, updatedAt: 2 };
const KEY = encodeURIComponent('study:横歩取り|white');
const keyAt = (moves: readonly string[], ply: number) => sfenKey(moves.slice(0, ply).reduce((sfen, m) => applyUsiMove(sfen, m)!.sfen, STARTPOS_SFEN));

const cp = (value: number) => ({ kind: 'cp' as const, value });
/** 本命 △6二玉・次善 △5二玉・悪手 △1四歩（咎め方 3 手） */
const TABLE: Candidate[] = [
  { move: '5a6b', mark: 'main', eval: cp(45) },
  { move: '5a5b', mark: 'alt', eval: cp(-35) },
  { move: '1c1d', mark: 'bad', eval: cp(-405), pv: ['3g3f', '1d1e', '2i3g'], reason: '端が間に合わない' },
];

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

async function putTable(page: Page, key: string, candidates: Candidate[]) {
  await page.evaluate(
    async ({ key, candidates }) => {
      const req = indexedDB.open('joban-tree');
      const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      await new Promise<void>((r) => {
        const tx = db.transaction('positions', 'readwrite');
        tx.objectStore('positions').put({ id: `white|${key}`, side: 'white', key, note: '', candidates, updatedAt: 1 });
        tx.oncomplete = () => r();
      });
      db.close();
    },
    { key, candidates },
  );
}

const tap = async (page: Page, board: string, from: string, to: string) => {
  await page.locator(`[data-testid="${board}"] [data-square="${from}"]`).click();
  await page.locator(`[data-testid="${board}"] [data-square="${to}"]`).click();
};

for (const [w, h] of [
  [360, 640],
  [360, 740],
  [390, 844],
  [412, 800],
  [1180, 820],
] as [number, number][]) {
  test(`${w}×${h}：悪手の行 → 盤で咎め方をたどる → 戻る（盤の大きさは同じ・1 画面）`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page, [A]);
    await putTable(page, keyAt(A.moves, 17), TABLE);
    await page.goto(`./#/book/${KEY}/s-a/17`);
    await page.reload();
    await expect(page.getByTestId('book-cand-row').filter({ hasText: '１四歩' })).toContainText('咎め方を見る');
    await page.waitForTimeout(400);
    const board = (await page.getByTestId('board').boundingBox())!;

    // 一覧の枠をいちばん下へ送ってから開いても、［戻る］が見える
    await page.locator('.tree-side.board-frame').evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.getByTestId('book-cand-row').filter({ hasText: '１四歩' }).click();
    await expect(page.getByTestId('refute-close')).toBeInViewport({ ratio: 1 });
    const closeHit = await page.getByTestId('refute-close').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const hit = (y: number) => document.elementFromPoint(x, y) === el;
      let top = r.y + r.height / 2;
      let bottom = top;
      while (hit(top - 0.5)) top -= 0.5;
      while (hit(bottom + 0.5)) bottom += 0.5;
      return bottom - top;
    });
    expect(closeHit).toBeGreaterThanOrEqual(43);
    await expect(page.getByTestId('refute-card')).toContainText('咎め方を見ています');
    await expect(page.getByTestId('study-position')).toHaveText('咎め方 0／3手');
    await expect(page.getByTestId('study-prev')).toBeDisabled();
    // 悪手を指した局面：1四に後手の歩がある
    const square = (s: string) => page.locator(`[data-testid="study-board"] [data-square="${s}"]`);
    await expect(square('14')).toContainText('歩');
    await expect(square('13')).not.toContainText('歩');

    await page.getByTestId('study-next').click();
    await expect(page.getByTestId('study-position')).toHaveText('咎め方 1／3手');
    await expect(page.getByTestId('refute-line').locator('li.on')).toHaveText('▲３六歩');
    await page.getByTestId('study-last').click();
    await expect(page.getByTestId('study-position')).toHaveText('咎め方 3／3手');
    await expect(page.getByTestId('study-next')).toBeDisabled();
    // 盤を押しても指せない
    await tap(page, 'study-board', '93', '94');
    await expect(square('93')).toContainText('歩');

    await page.waitForTimeout(300);
    expect((await page.getByTestId('board').boundingBox())!.width).toBeCloseTo(board.width, 0);
    const el = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, client: document.scrollingElement!.clientHeight }));
    expect(el.scroll).toBeLessThanOrEqual(el.client);

    await page.getByTestId('refute-close').click();
    await expect(page.getByTestId('study-position')).toContainText('17手目');
    await expect(square('13')).toContainText('歩');
    await expect(page.getByTestId('study-book-head')).toHaveText('研究 1本');
  });
}

async function practiceAt17(page: Page) {
  await setup(page, [A]);
  await putTable(page, keyAt(A.moves, 17), TABLE);
  await page.goto('./#/practice/play/s-a');
  await page.reload();
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
}

/** 正解を指して最後まで（17手目の後は △6二玉・△7二銀） */
async function finish(page: Page) {
  await tap(page, 'practice-board', '51', '62');
  await expect(page.getByTestId('practice-position')).toContainText('19手目');
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
  await tap(page, 'practice-board', '71', '72');
}

test('稽古：次善はまちがいにしない。本命を指すと続く', async ({ page }) => {
  await practiceAt17(page);
  await tap(page, 'practice-board', '51', '52');
  await expect(page.getByTestId('practice-other')).toContainText('△５二玉 は 次善 −80（まちがいにしません）');
  await expect(page.getByTestId('practice-card')).toContainText('本命は △６二玉');
  await expect(page.locator('.practice-pip.ng')).toHaveCount(0);
  await finish(page);
  await expect(page.getByTestId('practice-end')).toContainText('全部正解');
});

test('稽古：悪手はまちがい。咎め方を自動で見せて戻り、正解を指すと続く。もう一度・とばして戻る', async ({ page }) => {
  await practiceAt17(page);
  await tap(page, 'practice-board', '13', '14');
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'bad');
  await expect(page.getByTestId('practice-bad')).toContainText('△１四歩 は悪手です');
  await expect(page.getByTestId('practice-bad')).toContainText('悪手 −450');
  await expect(page.getByTestId('practice-refute')).toContainText('▲３六歩');
  await expect(page.getByTestId('practice-position')).toContainText('咎め方');
  await expect(page.locator('.practice-pip.ng')).toHaveCount(1);
  // 自動で最後まで見せて、問題の局面に戻る
  await expect(page.getByTestId('practice-answer')).toHaveText('△６二玉', { timeout: 10_000 });
  await expect(page.getByTestId('practice-position')).toHaveText('咎め方をもう一度見る');

  await page.getByTestId('practice-refute-again').click();
  await expect(page.getByTestId('practice-refute-skip')).toBeVisible();
  await page.getByTestId('practice-refute-skip').click();
  await expect(page.getByTestId('practice-answer')).toHaveText('△６二玉');

  await finish(page);
  await expect(page.getByTestId('practice-end')).toContainText('18手目 △６二玉');
  await expect(page.getByTestId('practice-end')).toContainText('次は明日');
});

test('咎め方を見ている間に悪手の印を外すと終わり、取り消しても勝手に戻らない', async ({ page }) => {
  await setup(page, [A]);
  await putTable(page, keyAt(A.moves, 17), TABLE);
  await page.goto(`./#/book/${KEY}/s-a/17`);
  await page.reload();
  await page.getByTestId('book-cand-row').filter({ hasText: '１四歩' }).click();
  await page.getByTestId('book-menu').click();
  await page.getByTestId('book-open-cand').click();
  await page.locator('[data-testid="cand-item"][data-move="1c1d"]').getByTestId('cand-item-menu').click();
  await page.getByTestId('mark-alt').click();
  await expect(page.getByTestId('refute-card')).toHaveCount(0);
  await page.getByTestId('book-toast-undo').click();
  await expect(page.getByTestId('book-toast')).toContainText('取り消しました');
  await expect(page.getByTestId('refute-card')).toHaveCount(0);
  await expect(page.getByTestId('study-position')).toContainText('17手目');
});

for (const [w, h] of [
  [360, 640],
  [412, 800],
] as [number, number][]) {
  test(`${w}×${h}：稽古の悪手（読み筋 10 手）でも盤は縮まず、とばす操作がいつも見える`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page, [A]);
    // 後手の端歩のあと、双方が駒を行き来する 10 手
    const pv = ['3g3f', '1d1e', '2i3g', '9c9d', '9g9f', '9d9e', '1g1f', '1e1f', '1i1f', '1a1f'];
    await putTable(page, keyAt(A.moves, 17), [TABLE[0], { move: '1c1d', mark: 'bad', eval: cp(-405), pv }]);
    await page.goto('./#/practice/play/s-a');
    await page.reload();
    await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
    await page.waitForTimeout(400);
    const board = (await page.getByTestId('board').boundingBox())!.width;
    await tap(page, 'practice-board', '13', '14');
    await expect(page.getByTestId('practice-refute-skip')).toBeInViewport({ ratio: 1 });
    await page.waitForTimeout(300);
    expect((await page.getByTestId('board').boundingBox())!.width).toBeCloseTo(board, 0);
    await page.getByTestId('practice-refute-skip').click();
    await expect(page.getByTestId('practice-refute-again')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('practice-answer')).toHaveText('△６二玉');
    expect((await page.getByTestId('board').boundingBox())!.width).toBeCloseTo(board, 0);
  });
}

test('食い違いの一覧で本命を選んだあと、取り消せる（窓の中・窓を閉じた後）', async ({ page }) => {
  const B: Study = { ...A, id: 's-b', name: '△5二玉', moves: [...G1, '5i5h', '5a5b', '3g3f'], createdAt: 1, updatedAt: 1 };
  // もう 1 か所：19手目 ▲3六歩 の後に △7二銀 と △8四飛
  const C: Study = { ...A, id: 's-c', name: '△8四飛', moves: [...G1, '5i5h', '5a6b', '3g3f', '8f8d'], createdAt: 1, updatedAt: 1 };
  await setup(page, [A, B, C]);
  await expect(page.getByTestId('conflict-notice')).toContainText('食い違い 2 か所');
  await page.getByTestId('conflict-open').click();
  await page.locator('[data-testid="conflict-main"][data-move="5a6b"]').click();
  await expect(page.getByTestId('conflict-dialog')).toContainText('△６二玉 を本命にしました');
  await page.getByTestId('conflict-undo').click();
  await expect(page.getByTestId('conflict-item')).toHaveCount(2);

  // 2 か所とも選ぶと窓は閉じて、画面の下の知らせから戻せる
  await page.locator('[data-testid="conflict-main"][data-move="5a6b"]').click();
  await expect(page.getByTestId('conflict-item')).toHaveCount(1);
  await page.locator('[data-testid="conflict-main"][data-move="7a7b"]').click();
  await expect(page.getByTestId('conflict-dialog')).toHaveCount(0);
  await page.getByTestId('conflict-toast').getByTestId('conflict-undo').click();
  await expect(page.getByTestId('conflict-notice')).toContainText('食い違い 1 か所');
});
