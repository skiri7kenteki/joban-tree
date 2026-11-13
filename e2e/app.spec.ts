// 画面の通し確認（段階1）：棋譜貼り付け → 局面選択 → 生成 → たどる → 自動保存
import { expect, test, type Page } from '@playwright/test';

/** トップから「新しいツリー」の画面を開く（service worker の準備が終わるのを待つ） */
async function openNewTree(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('new-tree').click();
  await expect(page.getByRole('heading', { name: '新しいツリー' })).toBeVisible();
}

test('ホーム画面に追加するための manifest とアイコンがある', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/joban-tree/manifest.webmanifest');
  const manifest = await (await request.get(href!)).json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) {
    const res = await request.get(`/joban-tree/${icon.src}`);
    expect(res.ok()).toBe(true);
  }
});

test('棋譜を貼り付けて、手順を前後に動かせる', async ({ page }) => {
  await openNewTree(page);
  await page.getByTestId('kifu-input').fill('7g7f 3c3d 2g2f 8c8d');
  await page.getByTestId('kifu-load').click();
  await expect(page.getByTestId('input-message')).toContainText('4 手を読み込みました');
  await expect(page.getByTestId('input-position')).toHaveText('4手目 △８四歩');
  // 手番は先手 → 初期値の「自分」は後手
  await expect(page.getByTestId('side-white')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('input-prev').click();
  await expect(page.getByTestId('input-position')).toHaveText('3手目 ▲２六歩');
  await expect(page.getByTestId('side-black')).toHaveAttribute('aria-checked', 'true');
});

test('盤をタップして指せる（駒を選んで行き先をタップ）', async ({ page }) => {
  await openNewTree(page);
  await page.locator('[data-square="77"]').click();
  await page.locator('[data-square="76"]').click();
  await expect(page.getByTestId('input-position')).toHaveText('1手目 ▲７六歩');
  // 後手の番。後手の 3 三の歩を 3 四へ（盤は常に先手が手前）
  await page.locator('[data-square="33"]').click();
  await page.locator('[data-square="34"]').click();
  await expect(page.getByTestId('input-position')).toHaveText('2手目 △３四歩');
  // 反則（動けないマス）は無視される
  await page.locator('[data-square="27"]').click();
  await page.locator('[data-square="25"]').click();
  await expect(page.getByTestId('input-position')).toHaveText('2手目 △３四歩');
});

test.describe('エンジンを使う通し確認', () => {
  test.skip(!process.env.ENGINE_AVAILABLE, 'エンジンがビルドされていないので省略（GitHub Actions では実行される）');

  test('貼り付け → 生成 → 候補手をたどる → 停止 → 自動保存', async ({ page }) => {
    test.setTimeout(180_000);
    page.on('console', (msg) => console.log(`[browser] ${msg.text()}`));
    await openNewTree(page);
    await page.getByTestId('kifu-input').fill('7g7f 3c3d 2g2f');
    await page.getByTestId('kifu-load').click();
    // 3 手目の後＝後手番。自分は先手（初期値）
    await expect(page.getByTestId('side-black')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('start-quick').click();

    // 生成が始まり、開始局面に相手の応手が並ぶ
    await expect(page.getByTestId('gen-status')).toHaveAttribute('data-phase', /running|done/, { timeout: 120_000 });
    const candidates = page.getByTestId('candidate');
    await expect(candidates.first()).toBeVisible({ timeout: 60_000 });
    await expect(candidates.first()).toContainText(/△/);
    await expect(candidates.first()).toContainText(/本線/);

    // 1 手進む（相手の応手）→ 自分の対応（未検証）が出る
    await candidates.first().click();
    await expect(page.getByTestId('crumb')).toHaveCount(1);
    await expect(page.getByTestId('candidate').first()).toContainText(/▲/);
    await expect(page.getByTestId('candidate').first()).toContainText('未検証');
    await page.getByTestId('nav-back').click();
    await expect(page.getByTestId('crumb')).toHaveCount(0);

    // 停止
    const stop = page.getByTestId('gen-stop');
    if (await stop.isVisible()) await stop.click();
    await expect(page.getByTestId('gen-status')).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });

    // この手を検証：相手の応手の後（自分の手番）で、自分の対応を調べ直して確定する
    await page.getByTestId('candidate').first().click();
    await expect(page.getByTestId('verify-here')).toBeVisible();
    await page.getByTestId('verify-here').click();
    await expect(page.getByTestId('gen-status')).toHaveAttribute('data-kind', 'verify');
    await expect(page.getByTestId('gen-status')).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
    await expect(page.getByTestId('candidate').first()).toContainText('検証済み');
    await expect(page.getByTestId('verify-here')).toHaveCount(0);

    // ここから展開：確定した手の先を、さっとで広げる（途中で止める）
    await page.getByTestId('candidate').first().click();
    await page.getByTestId('expand-here').click();
    await page.getByTestId('expand-quick').click();
    await expect(page.getByTestId('gen-status')).toHaveAttribute('data-kind', 'generate');
    await expect(page.getByTestId('candidate').first()).toBeVisible({ timeout: 60_000 });
    if (await stop.isVisible()) await stop.click();
    await expect(page.getByTestId('gen-status')).toHaveAttribute('data-phase', 'done', { timeout: 30_000 });
    await expect(page.getByTestId('gen-status')).toContainText('途中の局面から');
    await page.getByTestId('nav-back').click();
    await page.getByTestId('nav-back').click();

    // 一覧に保存されている
    await page.goto('./');
    await expect(page.getByTestId('tree-item').first()).toContainText('自分は先手', { timeout: 10_000 });
    await page.getByTestId('tree-item').first().click();
    await expect(page.getByTestId('candidate').first()).toBeVisible();
  });
});
