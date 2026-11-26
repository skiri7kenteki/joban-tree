// 段階22-4（v0.52.0）：定跡帳のタブは定跡帳ごとに 1 行・研究手順の一覧は定跡帳の ⋯・手順前後で同じ局面の研究をつなぐ
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';
import { openStudyList } from './study-list';

test.use({ viewport: { width: 360, height: 640 }, hasTouch: true });

const study = (id: string, name: string, moves: string, patch: Partial<Study> = {}): Study => ({
  id,
  name,
  note: '',
  moves: moves.split(' '),
  mySide: 'black',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});
// ▲7六歩 △3四歩 ▲2六歩 と ▲2六歩 △3四歩 ▲7六歩 は同じ局面（後手番の手番）
const A = study('s-a', '角道から', '7g7f 3c3d 2g2f 8c8d', { updatedAt: 3 });
const B = study('s-b', '飛車先から', '2g2f 3c3d 7g7f 4c4d 2f2e', { updatedAt: 2 });
const W = study('s-w', '後手の研究', '7g7f 3c3d', { mySide: 'white' });
/** 横歩取りの定跡帳に入る研究（その他と分かれる） */
const YOKOFU = study('s-y', '横歩の研究', '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c 3d3f');

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
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth)).toBeLessThanOrEqual(0);
const play = async (page: Page, from: string, to: string) => {
  for (const square of [from, to]) await page.locator(`[data-square="${square}"]`).click();
};

test('一覧は定跡帳ごとに 1 行。「その他」の行は平手からの盤で、一覧とまとめて稽古はその他の分だけ', async ({ page }) => {
  await setup(page, [A, B, W, YOKOFU]);
  await expect(page.getByTestId('study-item')).toHaveCount(0);
  await expect(page.getByTestId('book-group')).toHaveText([/横歩取り（先手番）\s*研究 1本/, /その他（後手番）\s*研究 1本/, /その他（先手番）\s*研究 2本/]);
  await noSideScroll(page);

  await page.getByTestId('book-group').filter({ hasText: 'その他（先手番）' }).getByTestId('book-group-open').click();
  await expect(page.getByTestId('book-title')).toHaveText('定跡帳平手から（先手番）');
  await page.getByTestId('book-menu').click();
  await expect(page.getByTestId('book-study-list')).toHaveText('研究手順の一覧（2本）');
  await expect(page.getByTestId('book-review')).toContainText('2 本');
  await page.getByTestId('book-study-list').click();
  const list = page.getByTestId('study-list-dialog');
  await expect(list.getByTestId('study-item')).toHaveText([/角道から/, /飛車先から/]);
  await noSideScroll(page);

  // 行を押すと、その研究手順の終わりの局面
  await list.getByTestId('study-item').filter({ hasText: '飛車先から' }).click();
  await expect(list).toHaveCount(0);
  await expect(page.getByTestId('study-title')).toHaveText('飛車先から');
  await expect(page.getByTestId('study-position')).toContainText('5手目');
  // 読み込み直しても、その他の分だけのまま
  await page.reload();
  await page.getByTestId('book-menu').click();
  await expect(page.getByTestId('book-study-list')).toHaveText('研究手順の一覧（2本）');
  await page.getByTestId('book-review').click();
  await expect(page.getByTestId('practice-title')).toContainText('稽古 1／2本');
});

test('一覧の ⋯ で名前を直す・消す（定跡帳の中のまま）', async ({ page }) => {
  await setup(page, [A, B]);
  const list = await openStudyList(page);
  await list.getByTestId('study-item').filter({ hasText: '角道から' }).locator('..').getByTestId('study-menu').click();
  await page.getByTestId('study-menu-edit').click();
  await page.getByTestId('study-name').fill('直した名前');
  await page.getByTestId('study-save').click();
  await expect(list.getByTestId('study-item').filter({ hasText: '直した名前' })).toHaveCount(1);
  await list.getByTestId('study-item').filter({ hasText: '飛車先から' }).locator('..').getByTestId('study-menu').click();
  await page.getByTestId('study-menu-delete').click();
  await page.getByTestId('study-menu-delete-ok').click();
  await expect(list.getByTestId('study-item')).toHaveCount(1);
  await expect(list).toContainText('研究手順の一覧（1本）');
});

test('手順前後：相手の手番にも合流する。押すと次の局面へ進んで手順が切り替わる。指しても同じ（足さない）', async ({ page }) => {
  await setup(page, [A, B]);
  const book = `./#/book/${encodeURIComponent('study:hirate|black')}/s-a/3`;
  await page.goto(book);
  await expect(page.getByTestId('study-book-head')).toHaveText('研究 2本');
  await expect(page.getByTestId('study-book-branch')).toHaveCount(2);
  await expect(page.getByTestId('book-transposed-tag')).toHaveCount(1);
  await noSideScroll(page);

  await page.getByTestId('study-book-branch').filter({ hasText: '飛車先から' }).click();
  await expect(page.getByTestId('study-title')).toHaveText('飛車先から');
  await expect(page.getByTestId('study-position')).toContainText('4手目 △４四歩');
  await expect(page.getByTestId('book-toast')).toHaveText('「飛車先から」の手順に切り替えました');

  // 同じ局面から盤で △4四歩 を指しても、研究手順は足さずに進むだけ
  await page.goto(book);
  await page.reload();
  await expect(page.getByTestId('study-title')).toHaveText('角道から');
  await play(page, '43', '44');
  await expect(page.getByTestId('study-title')).toHaveText('飛車先から');
  await expect(page.getByTestId('book-toast')).toContainText('の手順に切り替えました');
  await page.goto('./#/');
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 2 本');
});

test('合流した行の「この手から先を消す」は、手順前後で来る研究手順も消す。取り消せる', async ({ page }) => {
  const C = study('s-c', '手順前後の同じ手', '2g2f 3c3d 7g7f 8c8d 6i7h', { updatedAt: 1 });
  await setup(page, [A, C]);
  await page.goto(`./#/book/${encodeURIComponent('study:hirate|black')}/s-a/3`);
  await expect(page.getByTestId('study-book-branch')).toHaveCount(1);
  await expect(page.getByTestId('book-transposed-tag')).toHaveCount(0);
  await page.getByTestId('book-branch-menu').click();
  await expect(page.getByTestId('book-cut-text')).toContainText('研究手順 2 本を消します');
  await page.getByTestId('book-cut-ok').click();
  await expect(page.getByTestId('study-book-branch')).toHaveCount(0);
  await page.getByTestId('book-toast-undo').click();
  await expect(page.getByTestId('study-book-branch')).toHaveCount(1);
  await expect(page.getByTestId('study-book-head')).toHaveText('研究 2本');
});

test('一覧で直した・消した後は、前の書き込みの取り消しで書き戻さない', async ({ page }) => {
  await setup(page, [A]);
  await page.goto(`./#/book/${encodeURIComponent('study:hirate|black')}/s-a/4`);
  await play(page, '26', '25');
  await expect(page.getByTestId('book-toast')).toContainText('足しました');
  await page.getByTestId('book-menu').click();
  await page.getByTestId('book-study-list').click();
  const list = page.getByTestId('study-list-dialog');
  await list.getByTestId('study-menu').click();
  await page.getByTestId('study-menu-edit').click();
  await page.getByTestId('study-note').fill('一覧で書いたメモ');
  await page.getByTestId('study-save').click();
  // 一言は窓の中に出る
  await expect(list.getByTestId('study-list-message')).toContainText('直しました');
  await list.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByTestId('study-meta')).toContainText('一覧で書いたメモ');
  await page.getByTestId('book-menu').click();
  await expect(page.getByTestId('book-undo')).toBeDisabled();
});

test('「ここで終わりにする」：同じ行に手順前後の研究手順が混ざっていても、残ることを知らせる。行を消す確認には消える名前を出す', async ({ page }) => {
  const C = study('s-c', '手順前後の同じ手', '2g2f 3c3d 7g7f 8c8d 6i7h', { updatedAt: 1 });
  // C と同じ順の 2 本目（手順前後の側の 2 本は、残すのが 1 本で、もう 1 本は消える）
  const D = study('s-d', '消える方', '2g2f 3c3d 7g7f 8c8d 3i3h', { updatedAt: 0 });
  await setup(page, [A, C, D]);
  await page.goto(`./#/book/${encodeURIComponent('study:hirate|black')}/s-a/3`);
  await page.getByTestId('book-branch-menu').click();
  await expect(page.getByTestId('book-cut-text')).toContainText('研究手順 3 本を消します');
  await expect(page.getByTestId('book-cut-names')).toContainText('消える方');
  await page.getByTestId('book-cut-dialog').getByRole('button', { name: '閉じる' }).click();
  await page.getByTestId('book-menu').click();
  await page.getByTestId('book-end-here').click();
  await expect(page.getByTestId('book-end-dialog')).toContainText('手順前後で来る研究手順は残ります');
});

test('ほかのグループの研究手順の自分の手は「手順前後：名前」の行。印を付けられ、押すとその定跡帳へ', async ({ page }) => {
  const moves = YOKOFU.moves;
  const mine: Study = { ...YOKOFU, id: 's-yw', name: '横歩の後手', moves: [...moves, '8f8d'], mySide: 'white' };
  // 初めの 4 手の順だけが違うので、横歩取りのグループに入らない
  const other: Study = { ...YOKOFU, id: 's-o', name: '別の順の研究', moves: ['2g2f', '3c3d', '7g7f', '8c8d', ...moves.slice(4), '5a5b'], mySide: 'white' };
  await setup(page, [mine, other]);
  await page.goto(`./#/book/${encodeURIComponent('study:横歩取り|white')}/s-yw/17`);
  await expect(page.getByTestId('book-transposed')).toContainText('手順前後：別の順の研究');
  await page.getByTestId('book-transposed-menu').click();
  await page.getByTestId('mark-alt').click();
  await expect(page.getByTestId('book-transposed').getByTestId('book-mark-tag')).toHaveText('次善');
  await page.getByTestId('book-transposed').click();
  await expect(page.getByTestId('study-title')).toHaveText('別の順の研究');
  await expect(page.getByTestId('book-title')).not.toContainText('横歩取り');
});
