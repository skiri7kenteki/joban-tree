// 段階21-3（v0.49.0）：見えにくい手の印と、稽古での知らせ。依頼 2026-11-25
// - 候補の窓：本命に「見えにくい」の札と、目安であることの一言
// - 稽古：その局面では盤の上に「ここは知らないと指せない手」。盤の大きさは変わらず 1 画面。まちがえたら記録に残る
// エンジンは使わず、表を直接入れる（付け方の計算は tests/unit/candidates.test.ts、並びは tests/unit/practice.test.ts）
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import type { Candidate } from '../src/tree/candidates';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true });

const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
/** 後手番。17手目 ▲5八玉 の後に △6二玉 */
const A: Study = { id: 's-a', name: '青野流 △6二玉型', note: '', moves: [...G1, '5i5h', '5a6b', '3g3f', '7a7b'], mySide: 'white', createdAt: 2, updatedAt: 2 };
const KEY = encodeURIComponent('study:横歩取り|white');
const keyAt = (ply: number) => sfenKey(A.moves.slice(0, ply).reduce((sfen, m) => applyUsiMove(sfen, m)!.sfen, STARTPOS_SFEN));

const cp = (value: number) => ({ kind: 'cp' as const, value });
const TABLE: Candidate[] = [
  { move: '5a6b', mark: 'main', eval: cp(45), hard: true },
  { move: '5a5b', mark: 'alt', eval: cp(-35) },
];

async function setup(page: Page, candidates: Candidate[], study: Study = A) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [study] })),
  });
  await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${1} 本`);
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
    { key: keyAt(17), candidates },
  );
}

const tap = async (page: Page, from: string, to: string) => {
  await page.locator(`[data-testid="practice-board"] [data-square="${from}"]`).click();
  await page.locator(`[data-testid="practice-board"] [data-square="${to}"]`).click();
};

const records = (page: Page) =>
  page.evaluate(async () => {
    const req = indexedDB.open('joban-tree');
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const all = await new Promise<{ hardMistake?: boolean }[]>((r) => {
      const get = db.transaction('practice').objectStore('practice').getAll();
      get.onsuccess = () => r(get.result);
    });
    db.close();
    return all;
  });

for (const [w, h] of [
  [360, 640],
  [360, 740],
  [390, 844],
  [412, 800],
  [1180, 820],
] as [number, number][]) {
  test(`${w}×${h}：稽古の見えにくい手の局面で知らせる（盤の大きさは同じ・1 画面）`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page, TABLE);
    await page.goto('./#/practice/play/s-a');
    await page.reload();
    await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
    await expect(page.getByTestId('practice-hard')).toHaveText('ここは知らないと指せない手');
    await expect(page.getByTestId('practice-hard')).toBeInViewport({ ratio: 1 });
    await page.waitForTimeout(400);
    const board = (await page.getByTestId('board').boundingBox())!;
    const el = await page.evaluate(() => ({
      h: document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight,
      w: document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth,
    }));
    expect(el.h).toBeLessThanOrEqual(0);
    expect(el.w).toBeLessThanOrEqual(0);

    // 正解を指すと次の局面（印なし）では消え、盤の大きさと位置は変わらない
    await tap(page, '51', '62');
    await expect(page.getByTestId('practice-position')).toContainText('19手目');
    await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
    await expect(page.getByTestId('practice-hard')).toHaveCount(0);
    await page.waitForTimeout(300);
    const after = (await page.getByTestId('board').boundingBox())!;
    expect(after.width).toBeCloseTo(board.width, 0);
    expect(after.y).toBeCloseTo(board.y, 0);
  });
}

/** 自分の手が 28 手ある長い研究手順（丸が何段にも並ぶ）。A の後は両方の玉が行き来する */
const LONG: Study = { ...A, moves: [...A.moves, ...Array.from({ length: 13 }, () => ['5h5i', '6b5a', '5i5h', '5a6b']).flat()] };

// 理由の印が出ない稽古（まだ日が来ていない研究手順を前倒しで）と、丸が多い研究手順
for (const [name, study, done] of [
  ['理由の印なし', A, true],
  ['丸が 28 個', LONG, false],
  ['理由の印なし・丸が 28 個', LONG, true],
] as const) {
  test(`360×640：${name}でも、見えにくい手の知らせで盤が動かない`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await setup(page, TABLE, study);
    if (done) {
      await page.evaluate(async () => {
        const req = indexedDB.open('joban-tree');
        const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
        await new Promise<void>((r) => {
          const tx = db.transaction('practice', 'readwrite');
          const now = Date.now();
          tx.objectStore('practice').put({ studyId: 's-a', step: 3, dueAt: now + 7 * 86_400_000, lastAt: now, firstAt: now, lastMistakes: 0, count: 4 });
          tx.oncomplete = () => r();
        });
        db.close();
      });
    }
    await page.goto('./#/practice/play/s-a');
    await page.reload();
    await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
    await expect(page.getByTestId('practice-reason')).toBeHidden();
    await expect(page.getByTestId('practice-hard')).toBeInViewport({ ratio: 1 });
    await page.waitForTimeout(400);
    const board = (await page.getByTestId('board').boundingBox())!;
    const head = (await page.locator('.practice-head').boundingBox())!;
    await tap(page, '51', '62');
    await expect(page.getByTestId('practice-position')).toContainText('19手目');
    await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
    await expect(page.getByTestId('practice-pips')).toBeVisible();
    await page.waitForTimeout(300);
    const after = (await page.getByTestId('board').boundingBox())!;
    expect((await page.locator('.practice-head').boundingBox())!.height).toBeCloseTo(head.height, 0);
    expect(after.y).toBeCloseTo(board.y, 0);
    expect(after.width).toBeCloseTo(board.width, 0);
  });
}

async function playThrough(page: Page, first: [string, string]) {
  await page.goto('./#/practice/play/s-a');
  await page.reload();
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
  await tap(page, ...first);
  if (first[1] !== '62') {
    await expect(page.getByTestId('practice-hard')).toBeVisible();
    await tap(page, '51', '62');
  }
  await expect(page.getByTestId('practice-position')).toContainText('19手目');
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
  await tap(page, '71', '72');
  await expect(page.getByTestId('practice-end')).toBeVisible();
}

test('稽古：見えにくい手をまちがえると記録に残り、次に全部正解すると消える', async ({ page }) => {
  await setup(page, TABLE);
  await playThrough(page, ['13', '14']);
  await expect.poll(async () => (await records(page))[0]?.hardMistake).toBe(true);
  await playThrough(page, ['51', '62']);
  await expect.poll(async () => (await records(page))[0] && 'hardMistake' in (await records(page))[0]).toBe(false);
});

test('本命が研究の手でない局面・本命でない手の印では、稽古で知らせない', async ({ page }) => {
  await setup(page, [
    { move: '5a5b', mark: 'main', eval: cp(45), hard: true },
    { move: '5a6b', mark: 'alt', eval: cp(30), hard: true },
  ]);
  await page.goto('./#/practice/play/s-a');
  await page.reload();
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
  await expect(page.getByTestId('practice-hard')).toHaveCount(0);
});

test('候補の窓：本命に「見えにくい」の札と、目安の一言。本命を付け替えると消える', async ({ page }) => {
  await setup(page, TABLE);
  await page.goto(`./#/book/${KEY}/s-a/17`);
  await page.reload();
  await page.getByTestId('book-table').click();
  const dialog = page.getByTestId('book-cand-dialog');
  await expect(dialog.locator('[data-testid="cand-item"][data-move="5a6b"]').getByTestId('hard-tag')).toHaveText('見えにくい');
  await expect(dialog.getByTestId('hard-note')).toContainText('エンジンの浅い読みでは見つからない手');
  await dialog.locator('[data-testid="cand-item"][data-move="5a5b"]').getByTestId('cand-item-menu').click();
  await page.getByTestId('mark-main').click();
  await page.keyboard.press('Escape');
  if ((await page.getByTestId('book-cut-dialog').count()) > 0) await page.getByTestId('book-cut-dialog').getByRole('button', { name: '閉じる' }).click();
  await page.getByTestId('book-table').click();
  await expect(dialog.getByTestId('hard-tag')).toHaveCount(0);
  await expect(dialog.getByTestId('hard-note')).toHaveCount(0);
});
