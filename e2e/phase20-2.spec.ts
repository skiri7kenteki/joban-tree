// 段階20-2（v0.45.0）：エンジンに聞く（持ち主の判断 2026-11-24「全ておすすめの通りで」）
// - 定跡帳の一覧の見出しの行の［エンジンに聞く］→ 画面の下の窓。3 秒調べて候補を出す（保存しない）
// - 相手の手番：候補 4 つ＋研究の手。研究にある手は［進む］、無い手は［足す］（相手の手と自分の対応の 2 手を 1 回で取り消せる形で）
// - 自分の手番：候補 3 つ＋研究の手。「最善」「最善から −n」
// - 窓を閉じたら探索を止める（すぐ開き直しても調べられる）
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true });

const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
/** 後手番。17手目 ▲5八玉 の後に △6二玉（A）と △5二玉（B） */
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

test('見出しの行に［エンジンに聞く］がある（研究の本数と同じ行）', async ({ page }) => {
  await setup(page, [A, B]);
  await page.goto(`./#/book/${KEY}/s-a/17`);
  const head = page.getByTestId('study-book-head').locator('..');
  await expect(head.getByTestId('book-ask')).toHaveText('エンジンに聞く');
  // 見出しの行の中に収まる（はみ出して 2 行にならない）
  const ask = (await head.getByTestId('book-ask').boundingBox())!;
  const count = (await page.getByTestId('study-book-head').boundingBox())!;
  expect(Math.abs(ask.y + ask.height / 2 - (count.y + count.height / 2))).toBeLessThan(6);
});

test.describe('エンジンを使う', () => {
  test.skip(!process.env.ENGINE_AVAILABLE, 'エンジンがビルドされていないので省略（GitHub Actions では実行される）');
  test.setTimeout(120_000);

  test('相手の手番：候補と研究の手 → 進む → 足す（2 手）→ 1 回で取り消す', async ({ page }) => {
    await setup(page, [A, B]);
    await page.goto(`./#/book/${KEY}/s-a/16`);
    await expect(page.getByTestId('study-book-head')).toHaveText('研究 2本');

    await page.getByTestId('book-ask').click();
    const dialog = page.getByTestId('ask-dialog');
    await expect(dialog.locator('h2')).toHaveText('エンジンに聞く：相手の候補');
    await expect(dialog.getByTestId('ask-list')).toBeVisible({ timeout: 60_000 });
    const rows = dialog.getByTestId('ask-row');
    // 候補 4 つ（研究の ▲5八玉 が入っていなければ、調べ直して 5 行）
    expect(await rows.count()).toBeGreaterThanOrEqual(4);
    await expect(dialog.getByTestId('ask-sub')).toContainText('16手目 △３三角 の局面・3秒・');
    await expect(dialog.getByTestId('ask-sub')).toContainText('評価値は☖後手から');
    const book = dialog.locator('[data-testid="ask-row"][data-move="5i5h"]');
    await expect(book).toHaveAttribute('data-in-book', 'true');
    await expect(book).toContainText('研究あり');

    // 研究にある手は［進む］
    await book.getByTestId('ask-advance').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('study-position')).toContainText('17手目');

    // 戻って、研究に無い手を［足す］
    await page.getByTestId('study-prev').click();
    await page.getByTestId('book-ask').click();
    await expect(dialog.getByTestId('ask-list')).toBeVisible({ timeout: 60_000 });
    const add = dialog.locator('[data-testid="ask-row"][data-in-book="false"]').first();
    const move = await add.getAttribute('data-move');
    expect(move).not.toBe('5i5h');
    // 読み筋に自分の対応があれば 2 手（「▲X と △Y を足す」）、無ければ 1 手
    const two = ((await add.getByTestId('ask-add').getAttribute('aria-label')) ?? '').includes(' と ');
    await add.getByTestId('ask-add').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('book-toast')).toContainText('を足しました');
    // 相手の手を指した局面（17手目）。一覧に自分の対応の 1 本（1 手だけのときは「ここで終わる研究」）
    await expect(page.getByTestId('study-position')).toContainText('17手目');
    await expect(page.getByTestId(two ? 'study-book-branch' : 'study-book-ending')).toHaveCount(1);

    // トップに戻ると 3 本。取り消しは 1 回で 2 本に戻る
    await page.getByTestId('book-toast-undo').click();
    await expect(page.getByTestId('book-toast')).toContainText('取り消しました');
    await expect(page.getByTestId('study-position')).toContainText('16手目');
    await expect(page.getByTestId('study-book-head')).toHaveText('研究 2本');
  });

  test('自分の手番：最善と最善からの差、研究の手は 2 つとも出る。閉じてすぐ開き直しても調べられる', async ({ page }) => {
    await setup(page, [A, B]);
    await page.goto(`./#/book/${KEY}/s-a/17`);
    await page.getByTestId('book-ask').click();
    const dialog = page.getByTestId('ask-dialog');
    await expect(dialog.locator('h2')).toHaveText('エンジンに聞く：自分の候補');
    // すぐ閉じる（探索を止める）→ 開き直す
    await page.getByTestId('ask-close').click();
    await expect(dialog).toBeHidden();
    await page.getByTestId('book-ask').click();
    await expect(dialog.getByTestId('ask-list')).toBeVisible({ timeout: 60_000 });
    expect(await dialog.getByTestId('ask-row').count()).toBeGreaterThanOrEqual(3);
    await expect(dialog.getByTestId('ask-row').first()).toContainText('最善');
    for (const m of ['5a6b', '5a5b']) {
      await expect(dialog.locator(`[data-testid="ask-row"][data-move="${m}"]`)).toHaveAttribute('data-in-book', 'true');
    }
    // もっと調べる（10 秒）
    await dialog.getByTestId('ask-more').click();
    await expect(dialog.getByTestId('ask-status')).toContainText('調べています（10秒）');
    await expect(dialog.getByTestId('ask-list')).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByTestId('ask-sub')).toContainText('・10秒・');
  });
});
