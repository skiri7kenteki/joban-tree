// 段階20-1（v0.44.0）：局面メモと食い違いの知らせ（持ち主の判断 2026-11-24「全ておすすめの通りで」）
// - 局面メモ：一覧の見出しの行に 1 行目。窓で書く・直す・消す。手順前後で同じ局面に来ても同じメモ
// - 食い違い：自分の手番の同じ局面で研究手順によって自分の手が違う → 行に印・定跡帳のタブに知らせ・「このままでよい」で消える。手順前後の手は「手順前後」の行
// - 稽古：ほかの研究手順の手はまちがいにしない。まちがえたとき・ほかの研究の手のとき、その局面の局面メモ
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true });

const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
/** 後手番。17手目 ▲5八玉 の後に △6二玉（A）と △5二玉（B）＝食い違い */
const A: Study = { id: 's-a', name: '青野流 △6二玉型', note: '', moves: [...G1, '5i5h', '5a6b', '3g3f', '7a7b'], mySide: 'white', createdAt: 2, updatedAt: 2 };
const B: Study = { id: 's-b', name: '青野流 △5二玉', note: '', moves: [...G1, '5i5h', '5a5b', '3g3f'], mySide: 'white', createdAt: 1, updatedAt: 1 };
const KEY = encodeURIComponent('study:横歩取り|white');

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

async function writeMemo(page: Page, text: string) {
  await page.getByTestId('book-memo').click();
  await expect(page.getByTestId('book-memo-dialog')).toBeVisible();
  await page.getByTestId('book-memo-text').fill(text);
  await page.getByTestId('book-memo-save').click();
  await expect(page.getByTestId('book-memo-dialog')).toBeHidden();
}

test('局面メモ：書く → 見出しの行に 1 行目 → ほかの局面には出ない → 同じ局面ならほかの研究手順でも出る → 消す', async ({ page }) => {
  await setup(page, [A, B]);
  await page.goto(`./#/book/${KEY}/s-a/17`);
  await expect(page.getByTestId('book-memo')).toHaveText('＋ 局面メモ');
  await writeMemo(page, '▲5八玉には△6二玉が本筋\n▲3六歩なら△8四飛');
  await expect(page.getByTestId('book-memo')).toContainText('▲5八玉には△6二玉が本筋');
  await expect(page.getByTestId('book-memo')).not.toContainText('▲3六歩なら');

  // 1 手戻ると別の局面（メモ無し）
  await page.getByTestId('study-prev').click();
  await expect(page.getByTestId('book-memo')).toHaveText('＋ 局面メモ');

  // 研究手順 B の同じ局面（読み込み直しても残る）
  await page.goto(`./#/book/${KEY}/s-b/17`);
  await page.reload();
  await expect(page.getByTestId('book-memo')).toContainText('▲5八玉には△6二玉が本筋');

  // 窓で全文を読む・消す
  await page.getByTestId('book-memo').click();
  await expect(page.getByTestId('book-memo-text')).toHaveValue('▲5八玉には△6二玉が本筋\n▲3六歩なら△8四飛');
  await page.getByTestId('book-memo-delete').click();
  await expect(page.getByTestId('book-memo')).toHaveText('＋ 局面メモ');
});

test('食い違い：行に印 → 定跡帳のタブに知らせ → 見るでその局面 → このままでよいで消える', async ({ page }) => {
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
  await page.getByTestId('book-conflict-ok').click();
  await expect(page.getByTestId('book-conflict-tag')).toHaveCount(0);

  await page.goto('./');
  await expect(page.getByTestId('study-item')).toHaveCount(2);
  await expect(page.getByTestId('conflict-notice')).toHaveCount(0);

  // 「また知らせる」で戻る
  await page.goto(`./#/book/${KEY}/s-a/17`);
  await page.getByTestId('book-branch-menu').first().click();
  await page.getByTestId('book-conflict-unok').click();
  await expect(page.getByTestId('book-conflict-tag')).toHaveCount(2);
});

test('手順前後：同じ局面に別の手順で来る研究手順の手は「手順前後」の行。押すとその研究手順へ', async ({ page }) => {
  const x: Study = { id: 's-x', name: '研究X', note: '', moves: ['7g7f', '3c3d', '2g2f', '8c8d'], mySide: 'white', createdAt: 2, updatedAt: 2 };
  const y: Study = { id: 's-y', name: '研究Y', note: '', moves: ['2g2f', '3c3d', '7g7f', '4a3b'], mySide: 'white', createdAt: 1, updatedAt: 1 };
  await setup(page, [x, y]);
  await expect(page.getByTestId('conflict-notice')).toContainText('3手目');
  await page.getByTestId('conflict-open').click();
  await expect(page.getByTestId('study-book-branch')).toHaveCount(1);
  await expect(page.getByTestId('book-transposed')).toHaveCount(1);
  await expect(page.getByTestId('book-transposed')).toContainText('手順前後：研究');
  await expect(page.getByTestId('book-conflict-tag')).toHaveCount(2);
  const before = await page.getByTestId('study-title').textContent();
  await page.getByTestId('book-transposed').click();
  await expect(page.getByTestId('study-title')).not.toHaveText(before ?? '');
  await expect(page.getByTestId('study-position')).toContainText('3手目');
});

test('稽古：ほかの研究手順の手はまちがいにしない。局面メモをカードの下に出す', async ({ page }) => {
  await setup(page, [A, B]);
  await page.goto(`./#/book/${KEY}/s-a/17`);
  await writeMemo(page, '△6二玉と△5二玉の2つを研究');
  await page.goto('./#/practice/play/s-a');
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
  await expect(page.getByTestId('practice-position')).toContainText('17手目');

  // △5二玉（B の手）
  await page.locator('[data-testid="practice-board"] [data-square="51"]').click();
  await page.locator('[data-testid="practice-board"] [data-square="52"]').click();
  await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'other');
  await expect(page.getByTestId('practice-other')).toContainText('青野流 △5二玉');
  await expect(page.getByTestId('practice-memo')).toContainText('△6二玉と△5二玉の2つを研究');
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

test('局面メモは端末の保存場所（positions）に入る', async ({ page }) => {
  await setup(page, [A]);
  await page.goto(`./#/book/${KEY}/s-a/17`);
  await writeMemo(page, 'メモ');
  await page.goto('./#/settings');
  const file = await page.evaluate(async () => {
    const req = indexedDB.open('joban-tree');
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const all: unknown[] = await new Promise((r) => {
      const g = db.transaction('positions').objectStore('positions').getAll();
      g.onsuccess = () => r(g.result);
    });
    db.close();
    return all;
  });
  expect(file).toHaveLength(1);
  expect(file[0]).toMatchObject({ side: 'white', note: 'メモ' });
});
