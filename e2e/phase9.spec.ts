// 段階9-1：研究手順の手順を編集する（手を足す・1 手戻す・保存・途中で別の手 → 別の研究手順・置き換える・ここで終わりにする・やめる・
// ほかと同じ手順・戻るボタン）
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

/** 研究手順の JSON を取り込む（トップ画面の研究手順のタブから） */
async function importStudies(page: Page, studies: Study[]) {
  await page.getByTestId('tab-studies').click();
  await page.getByTestId('study-import-file').setInputFiles({
    name: 'studies.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
  });
  await expect(page.getByTestId('study-item')).toHaveCount(studies.length);
}

async function play(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

const study = (id: string, name: string, moves: string[], opts: Partial<Study> = {}): Study => ({
  id,
  name,
  note: '',
  moves,
  mySide: 'black',
  createdAt: 1,
  updatedAt: 1,
  ...opts,
});

/** 一覧から研究手順を開く */
async function openStudy(page: Page, name: string) {
  await page.getByTestId('study-item').filter({ hasText: name }).click();
  await expect(page.getByTestId('study-title')).toHaveText(name);
}

test.describe('9-1 研究手順の手順を編集する', () => {
  test('手順を編集 → 手を足す（1 手戻す）→ 保存 → 見返すと延びている。ふだんは盤で指せない', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('s-1', '研究1', ['7g7f', '3c3d', '2g2f'], { note: 'メモ' })]);
    await openStudy(page, '研究1');
    // ふだんは表示専用：盤をタップしても手順は変わらない
    await play(page, '83', '84');
    await expect(page.getByTestId('study-meta')).toContainText('3 手');
    await expect(page.getByTestId('study-edit-header')).toHaveCount(0);

    await page.getByTestId('study-edit-start').click();
    await expect(page).toHaveURL(/#\/study\/s-1\/edit$/);
    await expect(page.getByTestId('study-edit-header')).toContainText('手順を編集中');
    await expect(page.getByTestId('study-edit-status')).toContainText('手順の最後に足します');
    await expect(page.getByTestId('study-edit-undo')).toBeDisabled();
    await play(page, '83', '84');
    await play(page, '26', '25');
    await expect(page.getByTestId('study-position')).toHaveText('5手目 ▲２五歩');
    await expect(page.getByTestId('study-meta')).toContainText('5 手（保存前。元は 3 手）');
    // 1 手戻す
    await page.getByTestId('study-edit-undo').click();
    await expect(page.getByTestId('study-meta')).toContainText('4 手（保存前。元は 3 手）');
    await play(page, '26', '25');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    await page.getByTestId('study-edit-save').click();
    await expect(page).toHaveURL(/#\/study\/s-1$/);
    await expect(page.getByTestId('study-screen-status')).toHaveText('手順を保存しました（5 手）');
    await expect(page.getByTestId('study-meta')).toContainText('5 手');
    await expect(page.getByTestId('study-position')).toHaveText('5手目 ▲２五歩');
    // 自分で付けた名前とメモはそのまま
    await expect(page.getByTestId('study-title')).toHaveText('研究1');
    await expect(page.getByTestId('study-screen-note')).toHaveText('メモ');

    // 開き直しても延びている
    await page.reload();
    await expect(page.getByTestId('study-meta')).toContainText('5 手');
    await expect(page.getByTestId('study-crumb')).toHaveText(['▲７六歩', '△３四歩', '▲２六歩', '△８四歩', '▲２五歩']);
  });

  test('途中の局面で別の手を指す → 別の研究手順にする → 続けて編集して保存 → 一覧に 2 本並ぶ（元はそのまま）', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('s-1', '研究1', ['7g7f', '3c3d', '2g2f', '8c8d'], { note: '元のメモ' })]);
    await openStudy(page, '研究1');
    await page.getByTestId('study-edit-start').click();
    // 2 手目の局面へ戻って、次の手（▲2六歩）と違う ▲6六歩
    await page.getByTestId('study-crumb').nth(1).click();
    await expect(page.getByTestId('study-position')).toHaveText('2手目 △３四歩');
    await expect(page.getByTestId('study-edit-status')).toContainText('置き換える');
    await play(page, '67', '66');
    await expect(page.getByTestId('study-fork-dialog')).toContainText('▲６六歩 を指しました');
    await expect(page.getByTestId('study-fork-dialog')).toContainText('次の手は ▲２六歩 です');
    await expect(page.getByTestId('study-fork-replace')).toHaveText('ここから先を置き換える（後ろの 2 手を消す）');
    await page.getByTestId('study-fork-branch').click();

    await expect(page).toHaveURL(/#\/study\/s-(?!1\/)[\w-]+\/edit$/);
    await expect(page.getByTestId('study-edit-status')).toHaveText('別の研究手順を作りました：「▲７六歩 △３四歩 ▲６六歩」');
    await expect(page.getByTestId('study-title')).toHaveText('▲７六歩 △３四歩 ▲６六歩');
    await expect(page.getByTestId('study-position')).toHaveText('3手目 ▲６六歩');
    // 続けて足して保存（名前は初期値のままなので付け直す）
    await play(page, '83', '84');
    await page.getByTestId('study-edit-save').click();
    await expect(page).toHaveURL(/#\/study\/s-[\w-]+$/);
    await expect(page.getByTestId('study-title')).toHaveText('▲７六歩 △３四歩 ▲６六歩 △８四歩');
    await expect(page.getByTestId('study-meta')).toContainText('4 手');
    await expect(page.locator('.study-note')).toHaveCount(0);

    await page.goto('./');
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-item')).toHaveCount(2);
    await expect(page.getByTestId('study-item')).toHaveText([/▲７六歩 △３四歩 ▲６六歩 △８四歩/, /研究1/]);
    await openStudy(page, '研究1');
    await expect(page.getByTestId('study-meta')).toContainText('4 手');
    await expect(page.getByTestId('study-crumb')).toHaveText(['▲７六歩', '△３四歩', '▲２六歩', '△８四歩']);
    await expect(page.getByTestId('study-screen-note')).toHaveText('元のメモ');
  });

  test('ここで終わりにする（確認あり）・やめると元に戻る・ここから先を置き換える', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('s-1', '研究1', ['7g7f', '3c3d', '2g2f', '8c8d', '2f2e'])]);
    await openStudy(page, '研究1');
    await page.getByTestId('study-edit-start').click();
    await page.getByTestId('study-crumb').nth(2).click();
    await page.getByTestId('study-edit-truncate').click();
    await expect(page.getByTestId('study-truncate-dialog')).toContainText('後ろの 2 手を消します');
    await page.getByTestId('study-truncate-ok').click();
    await expect(page.getByTestId('study-meta')).toContainText('3 手（保存前。元は 5 手）');
    await expect(page.getByTestId('study-edit-truncate')).toBeDisabled();

    // やめる → 確認 → 元に戻る
    await page.getByTestId('study-edit-cancel').click();
    await page.getByTestId('study-cancel-ok').click();
    await expect(page).toHaveURL(/#\/study\/s-1$/);
    await expect(page.getByTestId('study-meta')).toContainText('5 手');
    await expect(page.getByTestId('study-screen-status')).toHaveText('編集をやめました（手順は元のままです）');

    // もう一度：ここで終わりにして保存
    await page.getByTestId('study-crumb').nth(2).click();
    await page.getByTestId('study-edit-start').click();
    await expect(page.getByTestId('study-position')).toHaveText('3手目 ▲２六歩');
    await page.getByTestId('study-edit-truncate').click();
    await page.getByTestId('study-truncate-ok').click();
    await page.getByTestId('study-edit-save').click();
    await expect(page.getByTestId('study-meta')).toContainText('3 手');

    // ここから先を置き換える
    await page.getByTestId('study-edit-start').click();
    await page.getByTestId('study-crumb').nth(0).click();
    await play(page, '83', '84');
    await page.getByTestId('study-fork-replace').click();
    await expect(page.getByTestId('study-meta')).toContainText('2 手（保存前。元は 3 手）');
    await page.getByTestId('study-edit-save').click();
    await expect(page.getByTestId('study-crumb')).toHaveText(['▲７六歩', '△８四歩']);
    // 初期局面では終わりにできない
    await page.getByTestId('study-edit-start').click();
    await page.getByTestId('study-crumb').nth(0).click();
    await page.getByRole('button', { name: '最初へ' }).click();
    await expect(page.getByTestId('study-edit-truncate')).toBeDisabled();
  });

  test('ほかの研究手順と同じ手順になると保存できない（編集に戻る／もう一方を開く）。戻るボタンで出ると変更を捨てるか聞く', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('s-1', '研究1', ['7g7f', '3c3d'], { updatedAt: 2 }), study('s-2', '研究2', ['7g7f', '3c3d', '2g2f'])]);
    await openStudy(page, '研究1');
    await page.getByTestId('study-edit-start').click();
    await play(page, '27', '26');
    await page.getByTestId('study-edit-save').click();
    await expect(page.getByTestId('study-save-same-dialog')).toContainText('研究手順「研究2」とまったく同じ');
    await page.getByTestId('study-save-same-back').click();
    await expect(page.getByTestId('study-edit-header')).toBeVisible();
    await expect(page.getByTestId('study-meta')).toContainText('3 手（保存前。元は 2 手）');

    // 戻るボタン → 変更を捨てるか聞く → 編集に戻る
    await page.goBack();
    await expect(page.getByTestId('study-edit-leave-dialog')).toContainText('研究手順「研究1」の手順に、まだ保存していない変更があります');
    await page.getByTestId('study-edit-leave-back').click();
    await expect(page).toHaveURL(/#\/study\/s-1\/edit$/);
    await expect(page.getByTestId('study-meta')).toContainText('3 手（保存前。元は 2 手）');
    // もう一度戻る → 捨てる
    await page.goBack();
    await page.getByTestId('study-edit-leave-discard').click();
    await expect(page.getByTestId('study-edit-leave-dialog')).toHaveCount(0);
    await expect(page.getByTestId('study-meta')).toContainText('2 手');
    await expect(page.getByTestId('study-edit-header')).toHaveCount(0);

    // 同じ手順 → もう一方を開く（変更は捨てる）
    await page.getByTestId('study-edit-start').click();
    await play(page, '27', '26');
    await page.getByTestId('study-edit-save').click();
    await page.getByTestId('study-save-same-open').click();
    await expect(page).toHaveURL(/#\/study\/s-2$/);
    await expect(page.getByTestId('study-title')).toHaveText('研究2');
    await page.goBack();
    await expect(page).toHaveURL(/#\/study\/s-1$/);
    await expect(page.getByTestId('study-meta')).toContainText('2 手');
    await expect(page.getByTestId('study-edit-leave-dialog')).toHaveCount(0);

    // 分かれる手がすでにある研究手順と同じ → 知らせて、その編集へ移れる
    await page.getByTestId('study-edit-start').click();
    await page.getByTestId('study-crumb').nth(1).click();
    await expect(page.getByTestId('study-position')).toHaveText('2手目 △３四歩');
    await page.getByTestId('study-crumb').nth(0).click();
    await play(page, '83', '84');
    await page.getByTestId('study-fork-branch').click();
    await expect(page).toHaveURL(/#\/study\/s-[\w-]+\/edit$/);
    await page.getByTestId('study-edit-cancel').click();
    // 「▲７六歩 △８四歩」を作ったので、もう一度同じ手で分かれるとすでにある
    await page.goto('./#/study/s-1');
    await page.getByTestId('study-edit-start').click();
    await page.getByTestId('study-crumb').nth(0).click();
    await play(page, '83', '84');
    await page.getByTestId('study-fork-branch').click();
    await expect(page.getByTestId('study-branch-same-dialog')).toContainText('研究手順「▲７六歩 △８四歩」としてすでにあります');
    await page.getByTestId('study-branch-same-open').click();
    await expect(page.getByTestId('study-edit-status')).toHaveText('「▲７六歩 △８四歩」の編集に移りました');
  });
});
