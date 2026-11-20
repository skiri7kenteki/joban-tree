// 段階11：画面の刷新（11-4 復習を小分けにする）
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
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
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('review-batch-10')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('review-batch-5').click();
    await page.goto('./');
    await page.getByTestId('tab-studies').click();
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
    await page.keyboard.press('Escape');

    // もう 5 問：新しい 1 回
    await expect(page.getByTestId('review-more')).toHaveText('もう 5 問');
    await page.getByTestId('review-more').click();
    await expect(progress).toHaveText('今日 1／5問');
  });
});
