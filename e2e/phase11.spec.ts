// 段階11：画面の刷新（11-4 復習を小分けにする・11-1 画面の下のタブ）
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

/**
 * 開いている窓を × で閉じる（窓が本当に開くまで待ってから押し、閉じたのを確かめる）。
 * Esc だと、遅い端末（GitHub の実行環境）で窓が開く前に押してしまい、後から開いた窓が次の操作をふさぐことがあった
 */
async function closeDialog(page: Page) {
  await page.locator('dialog[open]').last().getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

/** 画面の幅からはみ出している部品（「タグ.クラス 右端 "文字"」。無ければ空） */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const e of Array.from(document.querySelectorAll('body *'))) {
      const b = e.getBoundingClientRect();
      if (b.width > 0 && b.right > vw + 0.5) {
        const cls = typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className : '';
        out.push(`${e.tagName.toLowerCase()}.${cls} ${Math.round(b.right)} "${(e.textContent ?? '').trim().slice(0, 20)}"`);
      }
    }
    return out.slice(0, 8);
  });
}

async function play(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

/** 先手の手が 6 つある研究手順（▲7六歩 △3四歩 ▲2六歩 △8四歩 ▲2五歩 △8五歩 ▲7八金 △3二金 ▲2四歩 △同歩 ▲同飛） */
const LINE: Study = {
  id: 's-line',
  name: '横歩の手前',
  note: '',
  moves: '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d'.split(' '),
  mySide: 'black',
  createdAt: 1,
  updatedAt: 1,
};

test.describe('11-4 復習を小分けにする', () => {
  test('1 回の問題の数（設定で 5 問）を答えたら結果：正解の数・まちがえた問題（大きく見られる）・全体の数、もう 5 問', async ({ page }) => {
    await openHome(page);
    // 設定で 1 回 5 問に
    await page.getByTestId('tab-settings').click();
    await expect(page.getByTestId('review-batch-10')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('review-batch-5').click();
    await page.goto('./');
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-register')).toBeVisible();
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [LINE] })),
    });
    await page.getByTestId('study-menu').click();
    await page.getByTestId('study-menu-review').click();

    const progress = page.getByTestId('review-progress');
    await expect(progress).toHaveText('今日 1／5問');
    await expect(page.getByTestId('review-summary')).toContainText('問題 6（まだ 6');
    await play(page, '77', '76'); // 1 問目 正解
    await expect(progress).toHaveText('今日 2／5問');
    await play(page, '17', '16'); // 2 問目 まちがい
    await expect(page.getByTestId('review-wrong')).toBeVisible();
    await expect(progress).toHaveText('今日 2／5問');
    await page.getByTestId('review-show').click();
    await page.getByTestId('review-continue').click();
    await expect(progress).toHaveText('今日 3／5問');
    await play(page, '26', '25'); // 3 問目
    await expect(progress).toHaveText('今日 4／5問');
    await play(page, '69', '78'); // 4 問目
    await expect(progress).toHaveText('今日 5／5問');
    await play(page, '25', '24'); // 5 問目 → 結果

    await expect(page.getByTestId('review-result-score')).toHaveText('5 問中 4 問正解（1 回目で）');
    await expect(page.getByTestId('review-mistake')).toHaveCount(1);
    await expect(page.getByTestId('review-mistake')).toContainText('正解 ▲２六歩');
    await expect(page.getByTestId('review-mistake')).toContainText('指した手 ▲１六歩');
    await expect(page.getByTestId('review-result-overall')).toContainText('問題 6（まだ 1・前回まちがい 1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.getByTestId('review-mistake').click();
    await expect(page.getByTestId('review-mistake-dialog')).toBeVisible();
    await closeDialog(page);

    // もう 5 問：新しい 1 回
    await expect(page.getByTestId('review-more')).toHaveText('もう 5 問');
    await page.getByTestId('review-more').click();
    await expect(progress).toHaveText('今日 1／5問');
  });
});

test.describe('11-1 画面の下のタブ', () => {
  test('開くと定跡帳。タブで切り替え、戻るボタンで前のタブ。盤の画面にはタブを出さない。設定のタブにバージョン', async ({ page }) => {
    await openHome(page);
    await expect(page.getByRole('heading', { name: '定跡帳' })).toBeVisible();
    await expect(page.getByTestId('tab-studies')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('study-register')).toBeVisible();
    await expect(page.getByTestId('new-tree')).toHaveCount(0);

    await page.getByTestId('tab-trees').click();
    await expect(page).toHaveURL(/#\/trees$/);
    await expect(page.getByRole('heading', { name: 'ツリー' })).toBeVisible();
    await expect(page.getByTestId('new-tree')).toBeVisible();
    await expect(page.getByTestId('import-json')).toBeVisible();
    await expect(page.getByTestId('study-register')).toHaveCount(0);

    await page.getByTestId('tab-reviews').click();
    await expect(page).toHaveURL(/#\/reviews$/);
    await expect(page.getByTestId('reviews-batch')).toHaveText('1 回 10 問');
    await expect(page.getByTestId('reviews-studies-empty')).toBeVisible();
    await expect(page.getByTestId('reviews-trees-empty')).toBeVisible();

    await page.getByTestId('tab-settings').click();
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(page.getByTestId('app-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(page.getByTestId('feedback-open')).toBeVisible();
    // いちばん下まで送っても、タブに隠れない
    await page.getByTestId('feedback-open').scrollIntoViewIfNeeded();
    const tabTop = (await page.getByTestId('tabbar').boundingBox())!.y;
    const infoBottom = await page.getByTestId('feedback-open').evaluate((e) => e.getBoundingClientRect().bottom);
    expect(infoBottom).toBeLessThanOrEqual(tabTop);

    // 戻るボタンで前のタブへ
    await page.goBack();
    await expect(page.getByTestId('tab-reviews')).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page.getByTestId('tab-trees')).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page.getByTestId('tab-studies')).toHaveAttribute('aria-current', 'page');

    // 盤の画面（新しいツリー・定跡帳）にはタブを出さない
    await page.getByTestId('tab-trees').click();
    await page.getByTestId('new-tree').click();
    await expect(page.getByTestId('board')).toBeVisible();
    await expect(page.getByTestId('tabbar')).toHaveCount(0);
    await page.goto(`./#/book/${encodeURIComponent('study:hirate|black')}`);
    await expect(page.getByTestId('book-head-empty')).toBeVisible();
    await expect(page.getByTestId('tabbar')).toHaveCount(0);
    // 横にはみ出す部品があれば、その名前を出す（GitHub の実行環境は字の幅が違うので、どこがはみ出したか分かるように）
    expect(await overflowing(page)).toEqual([]);
  });

  test('復習のタブ：研究手順のグループごとに、前回まちがえた数と最後に復習した日。押すと復習、「終わる」で戻る', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('review-batch-5').click();
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-register')).toBeVisible();
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [LINE] })),
    });
    await expect(page.getByTestId('study-item')).toHaveCount(1);
    await page.getByTestId('tab-reviews').click();
    const group = page.getByTestId('reviews-group');
    await expect(group).toHaveCount(1);
    await expect(group).toContainText('1 本');
    await expect(group.getByTestId('reviews-overview')).toHaveText('まだ復習していません');

    await group.click();
    await expect(page).toHaveURL(/#\/study-review\/group\//);
    const progress = page.getByTestId('review-progress');
    await expect(progress).toHaveText('今日 1／5問');
    await play(page, '17', '16'); // 1 問目 まちがい
    await page.getByTestId('review-show').click();
    await page.getByTestId('review-continue').click();
    await expect(progress).toHaveText('今日 2／5問');
    await play(page, '27', '26');
    await expect(progress).toHaveText('今日 3／5問');
    await play(page, '26', '25');
    await expect(progress).toHaveText('今日 4／5問');
    await play(page, '69', '78');
    await expect(progress).toHaveText('今日 5／5問');
    await play(page, '25', '24'); // 5 問目 → 結果
    await expect(page.getByTestId('review-result-score')).toHaveText('5 問中 4 問正解（1 回目で）');

    // 終わる → 始めた画面（復習のタブ）へ。まとめが新しくなる
    await page.getByTestId('review-finish').click();
    await expect(page).toHaveURL(/#\/reviews$/);
    await expect(page.getByTestId('reviews-group').getByTestId('reviews-overview')).toHaveText('前回まちがえた 1 問・最後に復習 今日');
  });
});
