// 段階22-1（v0.49.1）：成る・成らないを選ぶ間も、選んだ後も、盤の大きさと位置が変わらない。依頼 2026-11-26
// （稽古の画面は、小窓の分だけ盤を縮めて、そのまま戻らなかった）。小窓を出す盤の画面（稽古・定跡帳）を確かめる
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true });

const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
/** 後手番。17手目 ▲5八玉 の局面で △8八角成（3三→8八）ができる */
const A: Study = { id: 's-a', name: '青野流 △6二玉型', note: '', moves: [...G1, '5i5h', '5a6b', '3g3f', '7a7b'], mySide: 'white', createdAt: 2, updatedAt: 2 };
const KEY = encodeURIComponent('study:横歩取り|white');

async function setup(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [A] })),
  });
  await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${1} 本`);
}

const boardBox = async (page: Page) => {
  await page.waitForTimeout(400);
  return (await page.getByTestId('board').boundingBox())!;
};

/** from の駒を to へ（成れる手なので小窓が出る）→ choice を押す。盤はずっと同じ大きさ・位置で、ページはスクロールしない */
async function expectSteadyBoard(page: Page, name: string, from: string, to: string, choice: string) {
  const before = await boardBox(page);
  await page.locator(`[data-testid="board"] [data-square="${from}"]`).click();
  await page.locator(`[data-testid="board"] [data-square="${to}"]`).click();
  const box = page.locator('.promote-box');
  await expect(box).toBeVisible();
  const during = await boardBox(page);
  expect.soft(during.width, `${name}：小窓の間の盤の幅`).toBeCloseTo(before.width, 0);
  expect.soft(during.y, `${name}：小窓の間の盤の位置`).toBeCloseTo(before.y, 0);
  // 小窓のボタンは 3 つとも画面の中で押せる
  for (const label of ['成る', '成らない', 'やめる']) {
    const button = box.getByRole('button', { name: label, exact: true });
    await expect.soft(button, `${name}：${label}`).toBeInViewport({ ratio: 1 });
    await button.click({ trial: true, timeout: 3000 });
  }
  // 盤（持ち駒の行も）を隠さない：小窓は盤より下に出る
  const boxTop = (await box.boundingBox())!.y;
  expect.soft(boxTop, `${name}：小窓は盤の下`).toBeGreaterThanOrEqual(during.y + during.height - 1);
  const scroll = await page.evaluate(() => document.scrollingElement!.scrollHeight - document.scrollingElement!.clientHeight);
  expect.soft(scroll, `${name}：ページのスクロール`).toBeLessThanOrEqual(0);
  await box.getByRole('button', { name: choice, exact: true }).click();
  await expect(box).toHaveCount(0);
  const after = await boardBox(page);
  expect.soft(after.width, `${name}：選んだ後の盤の幅`).toBeCloseTo(before.width, 0);
  expect.soft(after.y, `${name}：選んだ後の盤の位置`).toBeCloseTo(before.y, 0);
}

for (const [w, h] of [
  [360, 640],
  [390, 844],
  [1180, 820],
] as [number, number][]) {
  for (const choice of ['成る', '成らない', 'やめる']) {
    test(`${w}×${h}：稽古で「${choice}」を選んでも盤の大きさが変わらない`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await setup(page);
      await page.goto('./#/practice/play/s-a');
      await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
      await expectSteadyBoard(page, '稽古', '33', '88', choice);
    });
  }

  test(`${w}×${h}：定跡帳でも、成りの小窓で盤が動かない`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page);

    await page.goto(`./#/book/${KEY}/s-a/17`);
    await expect(page.getByTestId('study-position')).toContainText('17手目');
    await expectSteadyBoard(page, '定跡帳', '33', '88', 'やめる');
  });
}
