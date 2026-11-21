// v0.37.0：盤の画面 Dark Research Studio（持ち主の依頼 2026-11-21「おすすめの通りで」）
// - 定跡帳の盤：見出しの右にコピー・共有・⋯、★ の行は 2 段、操作バーは盤のすぐ下、研究候補から下だけスクロール
// - 盤を優先：スマホ縦は左右 16px の余白で、研究候補の見出しと 1.5 行が見える大きさまで
// - 研究候補の小さなラベル：本線（今の研究手順が進む手）・変化・終わり
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true });

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

const base = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b';
const mk = (id: string, name: string, tail: string, updatedAt: number): Study => ({
  id,
  name,
  note: `${name}のメモ`,
  moves: `${base} ${tail}`.split(' '),
  mySide: 'black',
  createdAt: 1,
  updatedAt,
});
/** 8 手目（△3二金 の後）で 3 つに分かれる。研究A がいちばん最近直したもの */
const STUDIES: Study[] = [mk('s-a', '研究A', '2e2d 2c2d', 9), mk('s-b', '研究B', '3i3h 7a7b', 8), mk('s-c', '研究C', '9g9f 9c9d', 7)];

async function openBook(page: Page) {
  await openHome(page);
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES })),
  });
  await expect(page.getByTestId('study-item')).toHaveCount(3);
  await page.getByTestId('study-item').first().click();
  await expect(page.getByTestId('study-title')).toHaveText('研究A');
  // 8 手目へ（研究A の終わりは 10 手目）
  await page.getByTestId('study-prev').click();
  await page.getByTestId('study-prev').click();
  await expect(page.getByTestId('study-position')).toContainText('8手目');
  await expect(page.getByTestId('study-book-branch')).toHaveCount(3);
}

for (const [w, h, minBoard] of [
  [390, 844, 356],
  [360, 640, 240],
  [360, 740, 320],
] as [number, number, number][]) {
  test(`定跡帳の盤 ${w}×${h}：盤は左右 16px、操作バーは盤のすぐ下、研究候補は 1.5 行まで見える。画面全体はスクロールしない`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openBook(page);
    const board = (await page.getByTestId('board').boundingBox())!;
    expect(Math.round(board.width)).toBeGreaterThanOrEqual(minBoard);
    expect(Math.round(board.x)).toBeGreaterThanOrEqual(16);
    expect(Math.round(board.x + board.width)).toBeLessThanOrEqual(w - 16);
    const wrap = (await page.locator('[data-testid="study-board"]').boundingBox())!;
    const bar = (await page.getByTestId('study-nav').boundingBox())!;
    expect(bar.y - (wrap.y + wrap.height)).toBeGreaterThanOrEqual(0);
    expect(bar.y - (wrap.y + wrap.height)).toBeLessThan(16);
    // 研究候補：1 行目は全部、2 行目は上の方が見える
    const rows = page.getByTestId('study-book-branch');
    const first = (await rows.nth(0).boundingBox())!;
    expect(first.y + first.height).toBeLessThanOrEqual(h);
    expect((await rows.nth(1).boundingBox())!.y).toBeLessThan(h);
    // 画面全体はスクロールしない（候補から下だけ）
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(h + 1);
    // 見出しのアイコン（コピー・共有・⋯）と戻るボタンは 44px の正方形
    for (const id of ['study-copy-kif', 'book-share', 'book-menu']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(Math.round(b.width)).toBeGreaterThanOrEqual(44);
      expect(Math.round(b.height)).toBeGreaterThanOrEqual(44);
    }
    // 局面を動かしても盤の大きさは変わらない
    await page.getByTestId('study-next').click();
    await expect(page.getByTestId('study-position')).toContainText('9手目');
    expect(Math.round((await page.getByTestId('board').boundingBox())!.width)).toBe(Math.round(board.width));
  });
}

test('研究候補のラベル：今の研究手順が進む手は本線、ほかは変化。ここで終わる研究は終わり。押すとその分岐へ', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBook(page);
  const rows = page.getByTestId('study-book-branch');
  // 並びは研究手順の多い手、同じなら最近直したものが上（研究A の ▲2四歩 が先頭）
  await expect(rows.nth(0)).toHaveAttribute('data-current', 'true');
  await expect(rows.nth(0).locator('.chip')).toHaveText('本線');
  await expect(rows.nth(1).locator('.chip')).toHaveText('変化');
  await expect(rows.nth(2).locator('.chip')).toHaveText('変化');
  // 分岐の手がいちばん大きい文字
  const move = await rows.nth(0).locator('.candidate-move').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const names = await rows.nth(0).locator('.book-names').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(move).toBeGreaterThan(names);
  // 変化の行を押すと、その研究手順に切り替わってその手の局面へ
  await rows.filter({ hasText: '研究B' }).click();
  await expect(page.getByTestId('study-title')).toHaveText('研究B');
  await expect(page.getByTestId('study-position')).toContainText('9手目');
  // 研究B の終わりまで行くと「ここで終わる研究」に終わりのラベル
  await page.getByTestId('study-last').click();
  await expect(page.getByTestId('study-book-ending')).toHaveCount(1);
  await expect(page.getByTestId('study-book-ending').locator('.chip')).toHaveText('終わり');
});

test('見出し：真ん中に定跡帳と戦型の名前。コピー・共有は見出しのアイコンから（共有は JSON／KIF を選ぶ窓）。★ の行は名前と「n 手　メモ」', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBook(page);
  await expect(page.getByTestId('book-title')).toHaveText('定跡帳平手から（先手番）');
  await expect(page.getByTestId('study-meta')).toHaveText('10 手　研究Aのメモ');
  // 名前は 2 段の上、メモはその下
  const title = (await page.getByTestId('study-title').boundingBox())!;
  const meta = (await page.getByTestId('study-meta').boundingBox())!;
  expect(meta.y).toBeGreaterThanOrEqual(title.y + title.height - 1);
  // 共有：JSON／KIF を選ぶ窓（画面の下から）
  await page.getByTestId('book-share').click();
  const dialog = page.getByTestId('book-share-dialog');
  await expect(dialog.getByTestId('study-share-json')).toBeVisible();
  await expect(dialog.getByTestId('study-share-kif')).toBeVisible();
  await page.locator('dialog[open]').last().getByRole('button', { name: '閉じる' }).click();
  // ⋯ の中に、コピー・共有はもう無い
  await page.getByTestId('book-menu').click();
  await expect(page.getByTestId('book-menu-dialog').getByTestId('study-copy-kif')).toHaveCount(0);
  await expect(page.getByTestId('book-menu-dialog').getByTestId('study-share-json')).toHaveCount(0);
});

test('研究手順の無い定跡帳では、コピー・共有は押せない（⋯ は押せる）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await page.goto(`./#/book/${encodeURIComponent('study:hirate|black')}`);
  await expect(page.getByTestId('book-head-empty')).toBeVisible();
  await expect(page.getByTestId('study-copy-kif')).toBeDisabled();
  await expect(page.getByTestId('book-share')).toBeDisabled();
  await expect(page.getByTestId('book-menu')).toBeEnabled();
  // 盤で指すと研究手順ができて、押せるようになる
  await page.locator('[data-square="77"]').click();
  await page.locator('[data-square="76"]').click();
  await expect(page.getByTestId('study-title')).toBeVisible();
  await expect(page.getByTestId('study-copy-kif')).toBeEnabled();
  await expect(page.getByTestId('book-share')).toBeEnabled();
});
