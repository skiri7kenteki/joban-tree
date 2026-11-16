// 段階5：戦型から選んでツリーを作る
import { expect, test, type Page } from '@playwright/test';

async function openNewTree(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('new-tree').click();
  await expect(page.getByRole('heading', { name: '新しいツリー' })).toBeVisible();
}

/** 「戦型から選ぶ」→ 横歩取り → 名前の戦型を選ぶ */
async function pickTemplate(page: Page, name: string) {
  await page.getByTestId('template-open').click();
  await expect(page.getByTestId('template-group')).toHaveCount(1);
  await page.getByTestId('template-group').filter({ hasText: '横歩取り' }).click();
  await page.getByTestId('template-item').filter({ hasText: name }).click();
  await expect(page.getByTestId('template-picker')).toHaveCount(0);
}

test.describe('5-1 戦型から選ぶ', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('グループ → 戦型 → 選ぶと、手順を読み込んだ状態になり、メモが盤の下に出る', async ({ page }) => {
    await openNewTree(page);
    await page.getByTestId('template-open').click();
    // グループの一覧（今は横歩取りだけ、6 つ）
    await expect(page.getByTestId('template-group')).toHaveText(/横歩取り\s*6/);
    await page.getByTestId('template-group').click();
    await expect(page.getByTestId('template-item')).toHaveCount(6);
    // 確認済みなので「未確認」は出ない
    await expect(page.getByTestId('template-unreviewed')).toHaveCount(0);
    // 戻ってグループの一覧に
    await page.getByTestId('template-back').click();
    await expect(page.getByTestId('template-group')).toBeVisible();
    await page.getByTestId('template-group').click();
    await page.getByTestId('template-item').filter({ hasText: '△3三角型' }).click();

    await expect(page.getByTestId('input-position')).toHaveText('17手目 ▲３六飛');
    await expect(page.getByTestId('template-note')).toContainText('横歩取り △3三角型（▲3六飛まで）');
    await expect(page.getByTestId('template-note')).toContainText('△3三角 ▲3六飛 の基本形');
    await expect(page.getByTestId('side-black')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('start-bar')).toContainText('17手目 ▲３六飛から作る（自分は☗先手）');

    // 手順を戻すと、戦型の途中なのでメモは隠れる。自分の側は先手のまま（戦型を選んだときは固定）
    await page.getByTestId('input-prev').click();
    await expect(page.getByTestId('input-position')).toHaveText('16手目 △３三角');
    await expect(page.getByTestId('template-note')).toHaveCount(0);
    await expect(page.getByTestId('side-black')).toHaveAttribute('aria-checked', 'true');
    // 自分の側は切り替えられる
    await page.getByTestId('side-white').click();
    await expect(page.getByTestId('side-white')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('input-next').click();
    await expect(page.getByTestId('side-white')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('template-note')).toBeVisible();

    // 盤上で先へ進めても、戦型の続きとしてメモが残る（△8四飛）
    await page.locator('[data-square="86"]').click();
    await page.locator('[data-square="84"]').click();
    await expect(page.getByTestId('input-position')).toHaveText('18手目 △８四飛');
    await expect(page.getByTestId('template-note')).toContainText('からさらに進めた局面');
  });

  test('後手の戦型（△4五角戦法）は自分が後手。棋譜を読み込むと戦型は外れる', async ({ page }) => {
    await openNewTree(page);
    await pickTemplate(page, '△4五角戦法');
    await expect(page.getByTestId('input-position')).toHaveText('20手目 △４五角');
    await expect(page.getByTestId('side-white')).toHaveAttribute('aria-checked', 'true');
    // 盤とメモ・作るボタンが重ならない
    await expect(page.getByTestId('template-note')).toBeVisible();
    await expect(page.getByTestId('start-normal')).toBeInViewport({ ratio: 1 });

    await page.getByTestId('kifu-open').click();
    await page.getByTestId('kifu-input').fill('7g7f 3c3d');
    await page.getByTestId('kifu-load').click();
    await expect(page.getByTestId('template-note')).toHaveCount(0);
    // 2 手目の後＝先手の番なので、自分は後手（これまで通りの初期値）
    await expect(page.getByTestId('side-white')).toHaveAttribute('aria-checked', 'true');
    // 戦型を外した後は、これまで通り手順を動かすと自分の側も変わる
    await page.getByTestId('input-prev').click();
    await expect(page.getByTestId('side-black')).toHaveAttribute('aria-checked', 'true');
  });

  test.describe('エンジンを使う', () => {
    test.skip(!process.env.ENGINE_AVAILABLE, 'エンジンがビルドされていないので省略（GitHub Actions では実行される）');

    test('戦型から作ったツリーの名前は戦型の名前', async ({ page }) => {
      test.setTimeout(120_000);
      await openNewTree(page);
      await pickTemplate(page, '青野流');
      await page.getByTestId('start-normal').click();
      await expect(page.getByRole('heading', { name: '横歩取り 青野流（▲5八玉まで）' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('gen-status')).toHaveAttribute('data-phase', /running|done/, { timeout: 60_000 });
      const stop = page.getByTestId('gen-stop');
      if (await stop.isVisible()) await stop.click();
    });
  });
});
