// 段階9-2：研究手順どうしをつないで見る（定跡帳として見る・この局面からの研究・切り替え・まとめて復習・KIF）。
// 段階9-1 の編集モードと研究手順の画面のテストは、段階10-2 で画面を片付けたので消した（定跡帳で指す形は e2e/phase10.spec.ts）
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

async function openHome(page: Page) {
  await page.goto('./#/trees');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

/** 研究手順の JSON を取り込む（トップ画面の研究手順のタブから） */
async function importStudies(page: Page, studies: Study[]) {
  await page.getByTestId('tab-studies').click();
  await expect(page.getByTestId('study-register')).toBeVisible();
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

const KAKU33 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c 3d3f'.split(' ');
const BOOK = [
  study('s-a', '研究A', [...KAKU33, '8f8d', '3f2f'], { updatedAt: 3, note: 'Aのメモ\n2 行目' }),
  study('s-b', '研究B', [...KAKU33, '8f8d', '5i5h'], { updatedAt: 2 }),
  study('s-c', '研究C', [...KAKU33, '5a5b'], { updatedAt: 1, note: 'Cのメモ' }),
];

test.describe('9-2 研究手順どうしをつないで見る', () => {
  test('定跡帳として見る：出発点からたどる・研究手順の数・ここで終わる研究・まとめて復習・定跡帳で指して延ばす', async ({ page }) => {
    await openHome(page);
    await importStudies(page, BOOK);
    await page.getByTestId('study-group-menu-open').first().click();
    await page.getByTestId('study-group-book').click();
    await expect(page.getByTestId('book-title')).toHaveText('定跡帳横歩取り（先手番）');
    // 出発点は 3 本が全部通る、先手番の戦型のうちいちばん浅いもの（基本図。段階10 の直し）。それより前には戻れない。いちばん最近直した研究A を見ている
    await expect(page.getByTestId('study-position')).toContainText('15手目');
    await expect(page.getByTestId('study-first')).toHaveAttribute('aria-label', /基本図/);
    await expect(page.getByTestId('study-prev')).toBeDisabled();
    await expect(page.getByTestId('study-title')).toHaveText('研究A');
    // 17 手目（▲3六飛 の後）へ
    await page.getByTestId('study-next').click();
    await page.getByTestId('study-next').click();
    await expect(page.getByTestId('study-position')).toContainText('17手目');
    await expect(page.getByTestId('study-meta')).toContainText('Aのメモ');
    await expect(page.getByTestId('study-book-head')).toHaveText('この局面からの研究（3 本）');
    const rows = page.getByTestId('study-book-branch');
    await expect(rows).toHaveCount(2);
    // 3 行目まで見える高さ（ここでは 2 行と、空けた分）
    const box = await rows.nth(1).boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(740);

    // △8四飛 → 2 本
    await rows.nth(0).click();
    await expect(page.getByTestId('study-book-head')).toHaveText('この局面からの研究（2 本）');
    // ▲5八玉 → 研究B に切り替わる。研究B はここで終わる
    await rows.filter({ hasText: '▲５八玉' }).click();
    await expect(page.getByTestId('study-title')).toHaveText('研究B');
    await expect(page).toHaveURL(/#\/book\/[^/]+\/s-b\/19$/);
    await expect(page.getByTestId('study-book-head')).toHaveText('この局面からの研究（1 本）');
    await expect(page.getByTestId('study-book-ending')).toContainText('研究B');
    await expect(page.getByTestId('study-book-ending')).toHaveAttribute('data-current', 'true');

    // 定跡帳の盤で指すと研究B が延びる（段階10-1。研究B・20 手目）
    await play(page, '51', '52');
    await expect(page).toHaveURL(/#\/book\/[^/]+\/s-b\/20$/);
    await expect(page.getByTestId('study-title')).toHaveText('研究B');
    await expect(page.getByTestId('study-position')).toContainText('20手目');

    // 出発点（15 手目）へ戻って 17 手目へ：今いちばん最近直したのは研究B。研究C へ切り替えて、その終わり
    await page.getByTestId('study-first').click();
    await expect(page.getByTestId('study-position')).toContainText('15手目');
    await page.getByTestId('study-next').click();
    await page.getByTestId('study-next').click();
    await expect(page.getByTestId('study-position')).toContainText('17手目');
    await rows.filter({ hasText: '研究C' }).click();
    await expect(page.getByTestId('study-title')).toHaveText('研究C');
    await expect(page.getByTestId('study-meta')).toContainText('Cのメモ');

    // まとめて復習
    await page.getByTestId('book-review').click();
    await expect(page).toHaveURL(/#\/study-review\/group\//);
    await expect(page.getByTestId('review-summary')).toContainText('研究手順 3 本');
  });

  test('定跡帳の KIF：研究手順の多い手が本譜、分かれ目は変化', async ({ page }) => {
    await openHome(page);
    await importStudies(page, BOOK);
    await page.goto(`./#/book/${encodeURIComponent('study:横歩取り|black')}`);
    await page.getByTestId('book-menu').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('book-share-kif').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^定跡帳-横歩取り（先手番）\.kifu$/);
    const text = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf-8');
    expect(text).toContain('変化：18手');
    expect(text).toContain('変化：19手');
    // 本譜は △8四飛 → ▲2六飛（研究A）
    expect(text.indexOf('★研究A')).toBeGreaterThan(0);
    expect(text.indexOf('★研究A')).toBeLessThan(text.indexOf('★研究B'));
    expect(text.indexOf('★研究A')).toBeLessThan(text.indexOf('★研究C'));
  });
});
