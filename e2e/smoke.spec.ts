// 画面の通し確認（段階0）：トップページが開き、service worker 経由で isolated になること
import { expect, test } from '@playwright/test';

test('トップページが開き、バージョンが出る', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '序盤ツリー' })).toBeVisible();
  await expect(page.getByTestId('app-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
});

test('service worker により cross-origin isolated になる（初回は 1 回だけ再読み込み）', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveText(/OK/, { timeout: 30_000 });
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
});
