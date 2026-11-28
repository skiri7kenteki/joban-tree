// 設定の整理：設定のタブは行の目次、各行は下の画面（#/settings/<名前>）へ進む
import { expect, test, type Page } from '@playwright/test';
import { openSettings, reopenSettings } from './settings';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const PAGES = [
  ['practice', '稽古'],
  ['games', '実戦'],
  ['data', 'データ管理'],
  ['sync', 'Google ドライブで同期'],
  ['engine', 'エンジン'],
] as const;

async function open(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

const onTop = async (page: Page) => {
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByTestId('settings-row-data')).toBeVisible();
};

test('設定のタブは 390×844 で 1 画面に収まり、行は 48px 以上', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-settings').click();
  await onTop(page);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(844);
  const rows = page.locator('.settings-row');
  await expect(rows).toHaveCount(7);
  // 機能の整理：ツリー（以前の機能）と気づきを送るは無い
  await expect(page.getByTestId('settings-row-trees')).toHaveCount(0);
  await expect(page.getByTestId('feedback-open')).toHaveCount(0);
  const tabTop = (await page.getByTestId('tabbar').boundingBox())!.y;
  for (const row of await rows.all()) {
    const box = (await row.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    expect(box.y + box.height).toBeLessThanOrEqual(tabTop);
  }
  await expect(page.getByTestId('settings-value-practice')).toHaveText('早送り する');
  await expect(page.getByTestId('settings-value-games')).toHaveText('未設定');
  await expect(page.getByTestId('settings-value-data')).toHaveText('未バックアップ');
  await expect(page.getByTestId('settings-value-sync')).toHaveText('未同期');
  await expect(page.getByTestId('settings-value-engine')).toHaveText('つようら王11micro');
});

test('各行から下の画面へ進み、「‹ 設定」と端末の戻るで戻る。下のタブは設定のまま', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-settings').click();
  for (const [id, title] of PAGES) {
    for (const how of ['button', 'device'] as const) {
      await page.getByTestId(`settings-row-${id}`).click();
      await expect(page).toHaveURL(new RegExp(`#/settings/${id}$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
      await expect(page.locator('h1.page-title')).toHaveCount(0);
      await expect(page.getByTestId('tab-settings')).toHaveAttribute('aria-current', 'page');
      const back = page.getByTestId('settings-back');
      await expect(back).toHaveText('‹ 設定');
      const box = (await back.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
      if (how === 'button') await back.click();
      else await page.goBack();
      await onTop(page);
    }
  }
  // 「‹ 設定」で戻っても履歴がたまらない：端末の戻る 1 回で、設定の前のタブ（定跡帳）へ
  await page.goBack();
  await expect(page.getByTestId('tab-studies')).toHaveAttribute('aria-current', 'page');
});

test('下の画面で下のタブの［設定］を押すと目次へ。読み込み直した後の「‹ 設定」も目次へ', async ({ page }) => {
  await open(page);
  await openSettings(page, 'engine');
  await page.getByTestId('tab-settings').click();
  await onTop(page);
  await page.getByTestId('settings-row-data').click();
  await page.reload();
  await page.getByTestId('settings-back').click();
  await onTop(page);
  // ほかの画面から直接開いた下の画面の「‹ 設定」は目次へ
  await reopenSettings(page, 'sync');
  await page.getByTestId('settings-back').click();
  await onTop(page);
  await page.goBack();
  await expect(page.getByTestId('tab-studies')).toHaveAttribute('aria-current', 'page');
});

test('下の画面で変えた設定は、戻って開き直しても残り、行の右にも出る', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('settings-row-practice').click();
  await page.getByTestId('skip-same-off').click();
  await page.getByTestId('settings-back').click();
  await page.getByTestId('settings-row-games').click();
  await page.getByTestId('wars-name').fill('sample_user');
  await page.getByTestId('wars-name').press('Tab');
  await page.getByTestId('settings-back').click();
  await page.getByTestId('settings-row-engine').click();
  await page.getByTestId('eval-mini').click();
  await page.getByTestId('settings-back').click();
  await page.reload();
  await expect(page.getByTestId('settings-value-practice')).toHaveText('早送り しない');
  await expect(page.getByTestId('settings-value-games')).toHaveText('sample_user');
  await expect(page.getByTestId('settings-value-engine')).toHaveText('つようら王11mini');

  // 初期値に戻す：やめると何も変わらない
  await page.getByTestId('reset-settings').click();
  const dialog = page.getByTestId('reset-dialog');
  await expect(dialog).toContainText('すべての設定を初期値に戻しますか？（ウォーズの名前は消えません）');
  await page.getByTestId('reset-cancel').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('settings-value-practice')).toHaveText('早送り しない');
  await expect(page.getByTestId('settings-value-engine')).toHaveText('つようら王11mini');
  // 戻す：ウォーズの名前は残る
  await page.getByTestId('reset-settings').click();
  await page.getByTestId('reset-confirm').click();
  await expect(page.getByTestId('settings-value-practice')).toHaveText('早送り する');
  await expect(page.getByTestId('settings-value-engine')).toHaveText('つようら王11micro');
  await expect(page.getByTestId('settings-value-games')).toHaveText('sample_user');
});

test('版が行に出る。エンジンの画面に速度測定は無い', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('app-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
  await openSettings(page, 'engine');
  await expect(page.getByTestId('good-max')).toBeVisible();
  await expect(page.getByTestId('open-bench')).toHaveCount(0);
});

test('データ管理を開いたら、すぐ［バックアップを保存］が押せて、行の右の日付が変わる', async ({ page }) => {
  await open(page);
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('settings-row-data').click();
  const save = page.getByTestId('backup-save');
  await expect(save).toBeEnabled();
  await Promise.all([page.waitForEvent('download'), save.click()]);
  await page.getByTestId('settings-back').click();
  await expect(page.getByTestId('settings-value-data')).toHaveText(/^バックアップ \d{1,2}\/\d{1,2}$/);
});
