// 設定の画面を開く共通の手順（設定の整理）。page を省くと設定のタブ（目次）
import { expect, type Page } from '@playwright/test';
import type { SettingsPage } from '../src/app/router';

export async function openSettings(page: Page, sub?: SettingsPage) {
  const path = sub ? `#/settings/${sub}` : '#/settings';
  await page.goto(`./${path}`);
  if (sub) await expect(page.getByTestId('settings-back')).toBeVisible();
  else await expect(page.getByTestId('settings-row-data')).toBeVisible();
}

/** 画面を作り直してから開く（前に開いていた同じ画面の表示が残らないように、定跡帳を経由する） */
export async function reopenSettings(page: Page, sub?: SettingsPage) {
  await page.goto('./#/');
  await openSettings(page, sub);
}
