// 機能の整理：消した画面の URL は定跡帳のタブを出す（壊れた画面を出さない）
import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('ツリー・古い URL を開くと定跡帳のタブ。#/reviews は稽古のタブ', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  for (const path of ['trees', 'new', 'new/study', 'tree/abc', 'tree/abc/study/s-1/3', 'review/abc', 'review/abc/study', 'study/s-1', 'study/s-1/edit', 'study-review/s-1', 'study-review/group/x', 'settings-none']) {
    await page.goto('./#/practice');
    await expect(page.getByTestId('tab-practice')).toHaveAttribute('aria-current', 'page');
    await page.goto(`./#/${path}`);
    await expect(page.getByTestId('tab-studies'), path).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('study-register'), path).toBeVisible();
  }
  // 消した設定の下の画面は設定の目次
  await page.goto('./#/settings/trees');
  await expect(page.getByTestId('settings-row-engine')).toBeVisible();
  await page.goto('./#/reviews');
  await expect(page.getByTestId('tab-practice')).toHaveAttribute('aria-current', 'page');
  expect(errors).toEqual([]);
});
