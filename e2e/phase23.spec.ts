// 段階23（v0.53.0）：研究候補の一覧の表示。持ち主の判断 2026-11-26「すべておすすめの通りで」
// - 行は 2 段：指し手（大きく太く）と札／研究手順名（小さく）。点の差・割合の棒・本数・▶ は出さない
// - 行の高さは 44px のまま。選んでいる行は木の茶の線と淡い茶の地
// - 見出しの行は、候補の表があれば［候補］（局面メモは整理-2 で画面から隠した）
// - 詳しい情報は行の ⋯ の窓の上。⋯ を押しても行は選ばれない
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import type { Candidate } from '../src/tree/candidates';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true });

const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
const A: Study = { id: 's-a', name: '青野流 △6二玉型', note: '', moves: [...G1, '5i5h', '5a6b', '3g3f', '7a7b'], mySide: 'white', createdAt: 3, updatedAt: 3 };
const B: Study = { id: 's-b', name: '青野流 △5二玉', note: '', moves: [...G1, '5i5h', '5a5b', '3g3f'], mySide: 'white', createdAt: 2, updatedAt: 2 };
/** A と同じ手を指す 2 本目（「ほか 1 本」になる） */
const C: Study = { id: 's-c', name: '△6二玉で受ける形', note: '', moves: [...G1, '5i5h', '5a6b', '4i3h'], mySide: 'white', createdAt: 1, updatedAt: 1 };
const KEY = encodeURIComponent('study:横歩取り|white');
const AT17 = sfenKey(A.moves.slice(0, 17).reduce((sfen, m) => applyUsiMove(sfen, m)!.sfen, STARTPOS_SFEN));
const MEMO = '▲5八玉には△6二玉が本筋';

const cp = (value: number) => ({ kind: 'cp' as const, value });
const TABLE: Candidate[] = [
  { move: '5a6b', mark: 'main', eval: cp(45), by: { engine: 'テスト', ms: 3000, at: 1 }, pv: ['3g3f', '7a7b'] },
  { move: '5a5b', mark: 'alt', eval: cp(-35), pv: ['3g3f'], reason: '飛車に当たりやすい' },
  { move: '1c1d', mark: 'bad', eval: cp(-405), pv: ['3g3f', '1d1e'] },
];

async function setup(page: Page, record?: { note: string; candidates?: Candidate[] }) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [A, B, C] })),
  });
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 3 本');
  if (!record) return;
  await page.evaluate(
    async ({ key, record }) => {
      const req = indexedDB.open('joban-tree');
      const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      await new Promise<void>((r) => {
        const tx = db.transaction('positions', 'readwrite');
        tx.objectStore('positions').put({ id: `white|${key}`, side: 'white', key, updatedAt: 1, ...record });
        tx.oncomplete = () => r();
      });
      db.close();
    },
    { key: AT17, record },
  );
}

async function openAt17(page: Page) {
  await page.goto(`./#/book/${KEY}/s-a/17`);
  await page.reload();
  await expect(page.getByTestId('study-position')).toContainText('17手目');
}

for (const [w, h] of [
  [360, 640],
  [390, 844],
  [1180, 820],
] as [number, number][]) {
  test(`${w}×${h}：行は 2 段で 44px。指し手が大きく、点の差・棒・本数は出ない`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page, { note: MEMO, candidates: TABLE });
    await openAt17(page);

    await expect(page.getByTestId('book-mark-tag')).toHaveText(['本命', '次善', '悪手']);
    await expect(page.getByTestId('study-book-bar')).toHaveCount(0);
    const first = page.getByTestId('study-book-branch').first();
    await expect(first).not.toContainText('▶');
    await expect(first).not.toContainText('（2）');
    await expect(first.locator('.book-names')).toHaveText('青野流 △6二玉型');
    await expect(first.locator('.book-more')).toHaveText('ほか 1 本');

    for (const row of await page.locator('[data-testid="study-book-branch"], [data-testid="book-cand-row"]').all()) {
      const box = (await row.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeLessThanOrEqual(44.5);
      const move = (await row.locator('.candidate-move').boundingBox())!;
      const names = (await row.locator('.book-sub').boundingBox())!;
      expect(names.y).toBeGreaterThanOrEqual(move.y + move.height - 1);
      expect(names.y + names.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    }
    const size = (selector: string) => first.locator(selector).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(await size('.candidate-move')).toBeGreaterThanOrEqual(18);
    expect(await size('.book-sub')).toBeLessThanOrEqual(13);

    // 狭いスマホでも研究手順名が切れない
    const cut = await first.locator('.book-names').evaluate((e) => e.scrollWidth - e.clientWidth);
    expect(cut).toBeLessThanOrEqual(0);

    // 選んでいる行：木の茶の左の線と淡い茶の地。ほかの行には無い
    const style = (i: number) =>
      page.getByTestId('study-book-branch').nth(i).evaluate((e) => {
        const s = getComputedStyle(e.closest('li')!);
        return { bg: s.backgroundColor, shadow: s.boxShadow };
      });
    expect(await style(0)).toEqual({ bg: 'rgb(243, 236, 226)', shadow: 'rgb(139, 107, 79) 3px 0px 0px 0px inset' });
    expect((await style(1)).shadow).toBe('none');

    const el = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, client: document.scrollingElement!.clientHeight, wide: document.scrollingElement!.scrollWidth }));
    expect(el.scroll).toBeLessThanOrEqual(el.client);
    expect(el.wide).toBeLessThanOrEqual(w);
  });
}

test('見出しの行：候補の表があれば［候補］。局面メモの中身も印も出さない', async ({ page }) => {
  await setup(page, { note: MEMO, candidates: TABLE });
  await openAt17(page);
  await expect(page.getByTestId('book-table')).toHaveText('候補');
  await expect(page.getByTestId('study-book-list')).not.toContainText(MEMO);
});

test('局面メモだけの局面には、ボタンを出さない', async ({ page }) => {
  await setup(page, { note: MEMO });
  await openAt17(page);
  await expect(page.getByTestId('study-book-branch').first()).toBeVisible();
  await expect(page.getByTestId('book-memo')).toHaveCount(0);
  await expect(page.getByTestId('book-table')).toHaveCount(0);
});

test('行の ⋯ の窓の上に詳しい情報。⋯ を押しても行は選ばれず、閉じても何も消えない', async ({ page }) => {
  await setup(page, { note: MEMO, candidates: TABLE });
  await openAt17(page);

  await page.getByTestId('book-branch-menu').nth(1).click();
  const dialog = page.getByTestId('book-cut-dialog');
  const detail = dialog.getByTestId('row-detail');
  await expect(detail).toContainText('次善 −80');
  await expect(detail).toContainText('−35');
  await expect(detail).toContainText('▲３六歩');
  await expect(detail).not.toContainText('飛車に当たりやすい');
  await expect(detail.getByTestId('row-detail-study')).toHaveText(['青野流 △5二玉']);
  await expect(detail).not.toContainText(MEMO);
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByTestId('study-position')).toContainText('17手目');
  await expect(page.getByTestId('study-title')).toHaveText('青野流 △6二玉型');
  await expect(page.getByTestId('study-book-head')).toHaveText('研究 3本');

  // 同じ手を指す研究手順は全部の名前（今たどっているものが先）
  await page.getByTestId('book-branch-menu').first().click();
  await expect(detail.getByTestId('row-detail-study')).toHaveText(['青野流 △6二玉型', '△6二玉で受ける形']);
  await dialog.getByRole('button', { name: '閉じる' }).click();

  // 研究手順の無い手の ⋯：読み筋と評価値
  await page.getByTestId('book-cand-menu').click();
  await expect(detail).toContainText('悪手 −450');
  await expect(detail.getByTestId('row-detail-study')).toHaveCount(0);
});

test('相手の手番の ⋯：研究手順名が先に出て、消すのは下のボタンを押したときだけ。行を押すと進む', async ({ page }) => {
  await setup(page);
  await openAt17(page);
  await page.getByTestId('study-prev').click();

  await page.getByTestId('book-branch-menu').click();
  const dialog = page.getByTestId('book-cut-dialog');
  await expect(dialog.getByRole('heading')).toHaveText('▲５八玉');
  await expect(dialog.getByTestId('row-detail-study')).toHaveCount(3);
  const detail = (await dialog.getByTestId('row-detail').boundingBox())!;
  const remove = (await dialog.getByTestId('book-cut-ok').boundingBox())!;
  expect(detail.y + detail.height).toBeLessThanOrEqual(remove.y);
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByTestId('study-book-head')).toHaveText('研究 3本');
  await expect(page.getByTestId('study-position')).toContainText('16手目');

  await page.getByTestId('study-book-branch').click();
  await expect(page.getByTestId('study-position')).toContainText('17手目');
});
