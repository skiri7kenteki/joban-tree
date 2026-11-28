// 段階20-3：定跡帳のタブの右上の「書き出し」は、設定の「データ」へ（「基本の研究を入れる」は整理-2 で画面から隠した。計算は tests/unit/basic-studies.test.ts）
import { openSettings } from './settings';
import { expect, test, type Page } from '@playwright/test';

test.use({ hasTouch: true });

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

const STUDY = { id: 's-a', name: '研究', note: '', moves: ['7g7f', '3c3d'], mySide: 'white', createdAt: 1, updatedAt: 1 };

test('書き出しは設定の「データ管理」に（研究手順があるときだけ）', async ({ page }) => {
  await openHome(page);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('settings-row-data').click();
  await expect(page.getByTestId('data-section')).toBeVisible();
  await expect(page.getByTestId('study-export-open')).toHaveCount(0);
  await page.getByTestId('tab-studies').click();
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [STUDY] })),
  });
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 1 本');
  await openSettings(page, 'data');
  await page.getByTestId('study-export-open').click();
  await expect(page.getByTestId('study-export-count')).toContainText('1 本');
});
