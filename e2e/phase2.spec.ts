// 画面の通し確認（段階2 のうち、今もある機能）：盤の向き・設定・オフライン
import { openSettings } from './settings';
import { expect, test, type Page } from '@playwright/test';

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

const STUDY = { id: 's-a', name: 'テストの研究', note: '', moves: ['7g7f', '3c3d'], mySide: 'white', createdAt: 1, updatedAt: 1 };

test('盤は常に先手が手前（自分が後手でも、9 一が左上・1 九が右下）', async ({ page }) => {
  await openHome(page);
  await page.goto(`./#/book/${encodeURIComponent('study:hirate|white')}`);
  const box = async (sq: string) => (await page.locator(`[data-square="${sq}"]`).boundingBox())!;
  const [nineOne, oneOne, oneNine] = [await box('91'), await box('11'), await box('19')];
  expect(nineOne.x).toBeLessThan(oneOne.x);
  expect(oneNine.y).toBeGreaterThan(oneOne.y);
});

test('設定：変えた値が保存され、初期値に戻せる', async ({ page }) => {
  await openHome(page);
  await openSettings(page, 'engine');
  await page.getByTestId('eval-mini').click();
  await page.getByTestId('good-max').fill('-10');
  await page.getByTestId('good-max').blur();
  // 範囲外の値は直る（「有力」は「本線」の上限より小さくできない）
  await expect(page.getByTestId('good-max')).toHaveValue('50');

  await page.reload();
  await expect(page.getByTestId('eval-mini')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('good-max')).toHaveValue('50');

  await openSettings(page);
  await page.getByTestId('reset-settings').click();
  await page.getByTestId('reset-confirm').click();
  await openSettings(page, 'engine');
  await expect(page.getByTestId('eval-micro')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('good-max')).toHaveValue('150');
});

test('オフラインでも開ける（一度開いたあとは、電波がなくても一覧と定跡帳が見られる）', async ({ page, context }) => {
  await openHome(page);
  // 手元の preview はヘッダを付けるので、service worker が働き始める前に isolated になる。
  // 公開版と同じ状態（service worker が担当している）になるまで待ち、もう一度開いて HTML を保存させる
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  await page.reload();
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [STUDY] })),
  });
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 1 本');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('tabbar')).toBeVisible();
  await page.getByTestId('book-group-open').click();
  await expect(page.getByTestId('study-board')).toBeVisible();
  await expect(page.getByTestId('study-book-branch').first()).toContainText('▲７六歩');
  await context.setOffline(false);
});
