// 段階20-1（v0.44.0）：局面メモと食い違いの知らせ（持ち主の判断 2026-11-24「全ておすすめの通りで」）
// - 局面メモ：一覧の見出しの行に 1 行目。窓で書く・直す・消す。手順前後で同じ局面に来ても同じメモ
//   （段階21-1 から、自分の手番は候補の窓のいちばん下。メモも表も無ければ ⋯ の「候補・局面メモ」から）
// - 食い違い：自分の手番の同じ局面で研究手順によって自分の手が違う → 行に印・定跡帳のタブに知らせ・本命を選ぶと消える（段階21-1 で「このままでよい」から変えた）。手順前後の手は「手順前後」の行
// - 稽古：ほかの研究手順の手はまちがいにしない。まちがえたとき・ほかの研究の手のとき、その局面の局面メモ
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true });

const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
/** 後手番。17手目 ▲5八玉 の後に △6二玉（A）と △5二玉（B）＝食い違い */
const A: Study = { id: 's-a', name: '青野流 △6二玉型', note: '', moves: [...G1, '5i5h', '5a6b', '3g3f', '7a7b'], mySide: 'white', createdAt: 2, updatedAt: 2 };
const B: Study = { id: 's-b', name: '青野流 △5二玉', note: '', moves: [...G1, '5i5h', '5a5b', '3g3f'], mySide: 'white', createdAt: 1, updatedAt: 1 };

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

test('食い違い：行に印 → 定跡帳のタブに知らせ → 見るでその局面 → 本命を選ぶと消える → 取り消し', async ({ page }) => {
  await setup(page, [A, B]);
  await expect(page.getByTestId('conflict-notice')).toContainText('食い違い 1 か所');
  await expect(page.getByTestId('conflict-notice')).toContainText('17手目');
  await page.getByTestId('conflict-open').click();

  await expect(page.getByTestId('study-position')).toContainText('17手目');
  await expect(page.getByTestId('study-book-branch')).toHaveCount(2);
  await expect(page.getByTestId('book-conflict-tag')).toHaveCount(2);
  // 相手の手番（16手目）では印は出ない
  await page.getByTestId('study-prev').click();
  await expect(page.getByTestId('book-conflict-tag')).toHaveCount(0);
  await page.getByTestId('study-next').click();

  await page.getByTestId('book-branch-menu').first().click();
  await expect(page.getByTestId('book-conflict-box')).toContainText('食い違い');
  await page.locator('[data-testid="conflict-main"][data-move="5a5b"]').click();
  await expect(page.getByTestId('book-conflict-tag')).toHaveCount(0);
  await expect(page.getByTestId('book-table')).toHaveText('候補');
  await expect(page.getByTestId('book-mark-tag')).toHaveText(['次善', '本命']);

  // 取り消すと食い違いに戻る → もう一度選ぶ
  await page.getByTestId('book-toast-undo').click();
  await expect(page.getByTestId('book-conflict-tag')).toHaveCount(2);
  await expect(page.getByTestId('book-table')).toHaveCount(0);
  await page.getByTestId('book-branch-menu').first().click();
  await page.locator('[data-testid="conflict-main"][data-move="5a6b"]').click();
  await expect(page.getByTestId('book-table')).toHaveText('候補');

  await page.goto('./');
  await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);
  await expect(page.getByTestId('conflict-notice')).toHaveCount(0);
});

test('手順前後：同じ局面に別の手順で来る研究手順の手は「手順前後」の行。押すとその研究手順へ', async ({ page }) => {
  const x: Study = { id: 's-x', name: '研究X', note: '', moves: ['7g7f', '3c3d', '2g2f', '8c8d'], mySide: 'white', createdAt: 2, updatedAt: 2 };
  const y: Study = { id: 's-y', name: '研究Y', note: '', moves: ['2g2f', '3c3d', '7g7f', '4a3b'], mySide: 'white', createdAt: 1, updatedAt: 1 };
  await setup(page, [x, y]);
  await expect(page.getByTestId('conflict-notice')).toContainText('3手目');
  await page.getByTestId('conflict-open').click();
  // 段階22-4：同じ定跡帳の手順前後は、ふつうの行にまとめて「手順前後」の印
  await expect(page.getByTestId('study-book-branch')).toHaveCount(2);
  await expect(page.getByTestId('book-transposed-tag')).toHaveCount(1);
  await expect(page.getByTestId('book-conflict-tag')).toHaveCount(2);
  const before = await page.getByTestId('study-title').textContent();
  await page.getByTestId('study-book-branch').filter({ has: page.getByTestId('book-transposed-tag') }).click();
  await expect(page.getByTestId('study-title')).not.toHaveText(before ?? '');
  await expect(page.getByTestId('book-toast')).toContainText('の手順に切り替えました');
  // 盤は次の局面へ進む
  await expect(page.getByTestId('study-position')).toContainText('4手目');
});

test('稽古：ほかの研究手順の手はまちがいにしない', async ({ page }) => {
  await setup(page, [A, B]);
  await page.goto('./#/practice/play/s-a');
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
  await expect(page.getByTestId('practice-position')).toContainText('17手目');

  // △5二玉（B の手）
  await page.locator('[data-testid="practice-board"] [data-square="51"]').click();
  await page.locator('[data-testid="practice-board"] [data-square="52"]').click();
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'other');
  await expect(page.getByTestId('practice-other')).toContainText('青野流 △5二玉');
  await expect(page.locator('.practice-pip.ng')).toHaveCount(0);

  // 正解の △6二玉 → 続く。最後まで全部正解
  await page.locator('[data-testid="practice-board"] [data-square="51"]').click();
  await page.locator('[data-testid="practice-board"] [data-square="62"]').click();
  await expect(page.getByTestId('practice-position')).toContainText('19手目');
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
  await page.locator('[data-testid="practice-board"] [data-square="71"]').click();
  await page.locator('[data-testid="practice-board"] [data-square="72"]').click();
  await expect(page.getByTestId('practice-end')).toContainText('全部正解');
});
