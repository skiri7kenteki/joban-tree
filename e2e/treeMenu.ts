// ツリーの閲覧画面の見出しの ⋯（段階11-2 から、局面ごとの操作のボタンはこの中）を使うテストの小さな関数
import { expect, type Locator, type Page } from '@playwright/test';

/** ⋯ を開く（窓が開くまで待つ） */
export async function openTreeMenu(page: Page) {
  await page.getByTestId('tree-menu').click();
  await expect(page.getByTestId('tree-menu-dialog')).toBeVisible();
}

/** ⋯ を開いて、その中のボタンを押す */
export async function treeMenu(page: Page, id: string) {
  await openTreeMenu(page);
  await page.getByTestId(id).click();
}

/** ⋯ を開いて中を確かめ、× で閉じる */
export async function inTreeMenu(page: Page, check: (menu: Locator) => Promise<void>) {
  await openTreeMenu(page);
  const menu = page.getByTestId('tree-menu-dialog');
  await check(menu);
  await menu.getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}
