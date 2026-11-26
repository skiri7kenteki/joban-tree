// 段階22-2（v0.50.0）：ほかの端末のバックアップを合わせる・消したことを運ぶ（依頼と判断 2026-11-26）
// - 端末 A と B（別々の保存場所）：A で保存 → B で合わせる → 両方の研究が残る → 戻す前のデータに戻す
// - 消した研究手順は、合わせた端末でも消える（確認の窓に名前）。取り消したものは、次に合わせても消えない
// 合わせ方の細かい決まりは tests/unit/merge.test.ts
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

const BASE = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d';
const study = (id: string, name: string, tail: string, createdAt: number): Study => ({
  id,
  name,
  note: '',
  moves: `${BASE} ${tail}`.trim().split(' '),
  mySide: 'black',
  createdAt,
  updatedAt: createdAt,
});
const SHARED_A = study('s-a-shared', '共通の研究', '', 5);
const SHARED_B = { ...SHARED_A, id: 's-b-shared', createdAt: 9, updatedAt: 9 };
const ONLY_A = study('s-a-only', 'iPad で足した研究', '8e8f', 6);
const ONLY_B = study('s-b-only', 'Android で足した研究', '5a5b', 7);

async function device(browser: Browser, studies: Study[], size = { width: 390, height: 844 }): Promise<Page> {
  const context = await browser.newContext({ viewport: size, hasTouch: true, acceptDownloads: true, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
  });
  await expect(page.getByTestId('study-item')).toHaveCount(studies.length);
  return page;
}

/** 設定の［バックアップを保存］でファイルを作る */
async function saveBackup(page: Page): Promise<string> {
  await page.goto('./#/');
  await page.goto('./#/settings');
  const save = page.getByTestId('backup-save');
  await expect(save).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
  return readFileSync((await download.path())!, 'utf8');
}

async function pickMerge(page: Page, text: string) {
  await page.goto('./#/');
  await page.goto('./#/settings');
  await page.getByTestId('backup-merge-file').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(text) });
}

async function confirmMerge(page: Page) {
  await Promise.all([page.waitForEvent('load'), page.getByTestId('backup-merge-confirm').click()]);
  await expect(page.getByTestId('backup-message')).toHaveText('ほかの端末のバックアップを合わせました。');
}

async function names(page: Page, expected: string[]) {
  await page.goto('./#/');
  await expect(page.getByTestId('study-item')).toHaveCount(expected.length);
  for (const name of expected) await expect(page.getByTestId('study-item').filter({ hasText: name })).toHaveCount(1);
}

test('A で保存して B で合わせると両方の研究が残る。戻す前のデータに戻せる', async ({ browser }) => {
  const a = await device(browser, [SHARED_A, ONLY_A]);
  const b = await device(browser, [SHARED_B, ONLY_B]);
  const fromA = await saveBackup(a);

  await pickMerge(b, fromA);
  const dialog = b.getByTestId('backup-merge-dialog');
  await expect(dialog.getByTestId('merge-row-studies')).toContainText('研究手順');
  await expect(dialog.getByTestId('merge-removed')).toHaveCount(0);
  await expect(dialog).toContainText('設定は変えません');
  await confirmMerge(b);
  await names(b, ['共通の研究', 'iPad で足した研究', 'Android で足した研究']);

  // B で保存して A で合わせると、A もそろう。もう一度合わせても増えない
  const fromB = await saveBackup(b);
  await pickMerge(a, fromB);
  await confirmMerge(a);
  await names(a, ['共通の研究', 'iPad で足した研究', 'Android で足した研究']);
  await pickMerge(a, fromB);
  await expect(a.getByTestId('merge-same')).toBeVisible();

  // 同じファイルをもう一度合わせても（中身は変わらない）、戻す前のデータは上書きしない
  await pickMerge(b, fromA);
  await expect(b.getByTestId('merge-same')).toBeVisible();
  await confirmMerge(b);

  await b.goto('./#/settings');
  await b.getByTestId('snapshot-restore').click();
  await Promise.all([b.waitForEvent('load'), b.getByTestId('backup-restore-confirm').click()]);
  await names(b, ['共通の研究', 'Android で足した研究']);
});

test('消した研究手順は合わせた端末でも消える。戻したものは、次に合わせても消えない', async ({ browser }) => {
  const a = await device(browser, [SHARED_A, ONLY_A]);
  const b = await device(browser, [SHARED_A, ONLY_A]);

  // A で消す
  await a.getByTestId('study-item').filter({ hasText: 'iPad で足した研究' }).locator('..').getByTestId('study-menu').click();
  await a.getByTestId('study-menu-delete').click();
  await a.getByTestId('study-menu-delete-ok').click();
  await expect(a.getByTestId('study-item')).toHaveCount(1);
  const fromA = await saveBackup(a);

  await pickMerge(b, fromA);
  await expect(b.getByTestId('merge-removed')).toContainText('iPad で足した研究');
  await confirmMerge(b);
  await names(b, ['共通の研究']);

  // B で［戻す前のデータに戻す］→ もう一度合わせても、戻した研究は残る
  await b.goto('./#/settings');
  await b.getByTestId('snapshot-restore').click();
  await Promise.all([b.waitForEvent('load'), b.getByTestId('backup-restore-confirm').click()]);
  await names(b, ['共通の研究', 'iPad で足した研究']);
  await pickMerge(b, fromA);
  await expect(b.getByTestId('merge-removed')).toHaveCount(0);
  await confirmMerge(b);
  await names(b, ['共通の研究', 'iPad で足した研究']);
});

test('おかしいファイルは断る。確認の窓は［やめる］で何も変えない（幅 360）', async ({ browser }) => {
  const a = await device(browser, [SHARED_A, ONLY_A]);
  const b = await device(browser, [ONLY_B], { width: 360, height: 640 });
  await pickMerge(b, '{"app":"joban-tree","kind":"studies"}');
  await expect(b.getByTestId('backup-error')).toContainText('バックアップのファイルではありません');
  await pickMerge(b, await saveBackup(a));
  const confirm = b.getByTestId('backup-merge-confirm');
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport({ ratio: 1 });
  const over = await b.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
  expect(over).toBeLessThanOrEqual(0);
  await b.getByTestId('backup-merge-dialog').getByRole('button', { name: 'やめる' }).click();
  await names(b, ['Android で足した研究']);
});

test('同じ手順の 2 本の片方を消しても、残した方は次に合わせても消えない', async ({ browser }) => {
  const one = { ...ONLY_A, id: 's-one', name: '残す方' };
  const two = { ...ONLY_A, id: 's-two', name: '消す方', createdAt: 8, updatedAt: 8 };
  const a = await device(browser, [one, two]);
  const before = await saveBackup(a);
  await a.goto('./#/');
  await a.getByTestId('study-item').filter({ hasText: '消す方' }).locator('..').getByTestId('study-menu').click();
  await a.getByTestId('study-menu-delete').click();
  await a.getByTestId('study-menu-delete-ok').click();
  await expect(a.getByTestId('study-item')).toHaveCount(1);
  await pickMerge(a, before);
  await expect(a.getByTestId('merge-removed')).toHaveCount(0);
  await confirmMerge(a);
  await names(a, ['残す方']);
});
