// 画面の通し確認（段階1）：トップページが開き、service worker 経由で isolated になること
import { expect, test } from '@playwright/test';

test('トップページ（定跡帳のタブ）が開き、設定のタブにバージョンが出る', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '定跡帳' })).toBeVisible();
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('app-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
});

test('service worker により cross-origin isolated になる（初回は 1 回だけ再読み込み）', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
});
