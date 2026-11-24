// 段階20-3（v0.46.0）：基本の研究・ツリーのタブの整理（持ち主の判断 2026-11-24「全ておすすめの通りで」）
// - 「＋ 研究手順を登録」→「基本の研究を入れる」：横歩取り △3三角（後手番）の 4 本（未確認）。選んで入れる → 戦型の出発点で定跡帳。すでにあるものは入れない
// - 定跡帳のタブの右上の「書き出し」は、設定の「データ」へ
import { expect, test, type Page } from '@playwright/test';

test.use({ hasTouch: true });

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

async function openBasic(page: Page) {
  await page.getByTestId('study-register').click();
  await page.getByTestId('study-register-basic').click();
  await expect(page.getByTestId('basic-dialog')).toBeVisible();
}

test('基本の研究：4 本・未確認 → 1 本外して 3 本入れる → 定跡帳の出発点 → もう一度開くと入れたものは選べない', async ({ page }) => {
  await openHome(page);
  await expect(page.getByTestId('study-export-open')).toHaveCount(0);
  await openBasic(page);
  const dialog = page.getByTestId('basic-dialog');
  await expect(dialog.getByTestId('basic-set')).toContainText('横歩取り △3三角（後手番）');
  await expect(dialog.getByTestId('basic-unreviewed')).toHaveText('未確認');
  await expect(dialog.getByTestId('basic-row')).toHaveCount(4);
  await expect(dialog.getByTestId('basic-row').first()).toContainText('28手目まで');
  await expect(dialog.getByTestId('basic-add')).toHaveText('4 本を定跡帳に入れる');
  // 2 本目（▲６八玉）を外す
  await expect(dialog.getByTestId('basic-row').nth(1)).toContainText('▲６八玉');
  await dialog.getByTestId('basic-check').nth(1).uncheck();
  await expect(dialog.getByTestId('basic-add')).toHaveText('3 本を定跡帳に入れる');
  await dialog.getByTestId('basic-add').click();

  // 戦型の出発点（16手目 △３三角）で定跡帳。次の手は ▲５八玉 と ▲３六飛（2 本）
  await expect(page).toHaveURL(/#\/book\/.+\/(t\/yokofu-33kaku-gote|[^/]+\/16)$/);
  await expect(page.getByTestId('study-position')).toContainText('16手目');
  await expect(page.getByTestId('study-book-head')).toHaveText('研究 3本');
  await expect(page.getByTestId('study-book-branch')).toHaveCount(2);

  // 定跡帳のタブに 3 本。もう一度開くと、入れたものは「入れてあります」
  await page.goto('./');
  await expect(page.getByTestId('study-item')).toHaveCount(3);
  await openBasic(page);
  await expect(dialog.getByTestId('basic-row').filter({ hasText: '入れてあります' })).toHaveCount(3);
  await expect(dialog.getByTestId('basic-check').nth(0)).toBeDisabled();
  await expect(dialog.getByTestId('basic-check').nth(1)).toBeChecked();
  await expect(dialog.getByTestId('basic-add')).toHaveText('1 本を定跡帳に入れる');
  await dialog.getByTestId('basic-add').click();
  await expect(page.getByTestId('study-book-head')).toHaveText('研究 4本');
  await page.goto('./');
  await expect(page.getByTestId('study-item')).toHaveCount(4);
  await openBasic(page);
  await expect(dialog.getByTestId('basic-add')).toHaveText('入れるものがありません');
  await expect(dialog.getByTestId('basic-add')).toBeDisabled();
});

test('書き出しは設定の「データ」に（研究手順があるときだけ）', async ({ page }) => {
  await openHome(page);
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('data-section')).toBeVisible();
  await expect(page.getByTestId('study-export-open')).toHaveCount(0);
  await page.getByTestId('tab-studies').click();
  await openBasic(page);
  await page.getByTestId('basic-add').click();
  await expect(page.getByTestId('study-book-head')).toHaveText('研究 4本');
  await page.goto('./#/settings');
  await page.getByTestId('study-export-open').click();
  await expect(page.getByTestId('study-export-count')).toContainText('4 本');
});
