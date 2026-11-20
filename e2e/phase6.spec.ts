// 段階6-3：用意済みのツリー（同梱ツリー）を開く
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { BundledTreeFile } from '../src/tree/bundled';
import { TREE_FORMAT_VERSION } from '../src/tree/types';

const FILE = 'yokofu-33kaku-gote.v1.json';
const NAME = '横歩取り △3三角（後手番）';

async function openNewTree(page: Page) {
  await page.goto('./#/trees');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('new-tree').click();
  await expect(page.getByRole('heading', { name: '新しいツリー' })).toBeVisible();
}

async function pickTemplate(page: Page, name: string) {
  await page.getByTestId('template-open').click();
  await page.getByTestId('template-group').filter({ hasText: '横歩取り' }).click();
  await page.getByTestId('template-item').filter({ hasText: name }).click();
  await expect(page.getByTestId('template-picker')).toHaveCount(0);
}

/** 新しいツリー → 戦型から △3三角（後手番）を選ぶ */
async function pick33kaku(page: Page) {
  await page.getByTestId('new-tree').click();
  await pickTemplate(page, '△3三角（後手番）');
  await expect(page.getByTestId('template-current')).toHaveText(`戦型：${NAME}`);
}

test.describe('6-3 用意済みのツリーを開く', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('戦型を選ぶと「用意済みのツリーを開く」が作るボタンより目立って出る → 開くと一覧にコピー（用意済みの印）→ 2 回目は同じコピーを開く → 新しくコピーもできる', async ({ page }) => {
    await openNewTree(page);
    // 戦型を選ぶ前（平手の初期局面）には出ない
    await expect(page.getByTestId('bundled-offer')).toHaveCount(0);
    await expect(page.getByTestId('start-normal')).toHaveClass(/btn-primary/);
    await page.goto('./#/trees');
    await pick33kaku(page);

    const open = page.getByTestId('bundled-open');
    await expect(open).toBeVisible();
    await expect(open).toBeEnabled();
    await expect(open).toHaveClass(/btn-primary/);
    await expect(page.getByTestId('bundled-facts')).toHaveText('6 往復（12 手先）・4,562 局面・2026/11/17 作成');
    // 作るボタンは目立たない形に（「ふつう」も普通のボタン）
    await expect(page.getByTestId('start-normal')).not.toHaveClass(/btn-primary/);
    // 用意済みのボタンは、作るボタンより上にあり、幅が広く（色付き）、画面の中に見えている
    const openBox = (await open.boundingBox())!;
    const startBox = (await page.getByTestId('start-normal').boundingBox())!;
    expect(openBox.y).toBeLessThan(startBox.y);
    expect(openBox.width).toBeGreaterThan(startBox.width * 1.5);
    expect(openBox.height).toBeGreaterThanOrEqual(startBox.height);
    expect(openBox.y + openBox.height).toBeLessThanOrEqual(844);
    // まだコピーが無いので「新しくコピー」は無い
    await expect(page.getByTestId('bundled-copy-again')).toHaveCount(0);

    // 自分の側を先手に変えると、用意済みのツリー（後手番）は出ない
    await page.getByTestId('side-black').click();
    await expect(page.getByTestId('bundled-offer')).toHaveCount(0);
    await page.getByTestId('side-white').click();

    // 開く → 閲覧画面。出発点の相手の応手 4 つ（▲5八玉・▲6八玉・▲9六歩・▲3六飛）
    await open.click();
    await expect(page).toHaveURL(/#\/tree\/[\w-]+$/);
    const firstUrl = page.url();
    await expect(page.getByTestId('candidate')).toHaveCount(4);
    await expect(page.getByTestId('candidate').first()).toContainText('▲５八玉');
    await expect(page.getByTestId('candidates-title')).toContainText('相手の応手（4）');
    // 生成は始まらない（待たずに読める）
    await expect(page.getByTestId('gen-status')).toHaveCount(0);

    // 一覧：「用意済み」の印・局面の数
    await page.goto('./#/trees');
    const items = page.getByTestId('tree-item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText(NAME);
    await expect(items.first().getByTestId('bundled-chip')).toHaveText('用意済み');
    await expect(items.first()).toContainText('4562 局面');
    await expect(items.first()).toContainText('自分：☖後手');

    // 2 回目：コピーを増やさず、同じツリーを開く
    await pick33kaku(page);
    await expect(page.getByTestId('bundled-copy-again')).toBeVisible();
    await page.getByTestId('bundled-open').click();
    await expect(page).toHaveURL(firstUrl);
    await page.goto('./#/trees');
    await expect(items).toHaveCount(1);

    // 「新しくコピー」を選ぶと 2 つ目のコピー（名前に番号）
    await pick33kaku(page);
    await page.getByTestId('bundled-copy-again').click();
    await expect(page).toHaveURL(/#\/tree\/[\w-]+$/);
    expect(page.url()).not.toBe(firstUrl);
    await page.goto('./#/trees');
    await expect(items).toHaveCount(2);
    await expect(page.getByTestId('tree-item').filter({ hasText: `${NAME}（2）` })).toHaveCount(1);
    await expect(page.getByTestId('bundled-chip')).toHaveCount(2);
  });

  test('開いたツリーで、閲覧（たどる）・ここから展開・復習が使える', async ({ page }) => {
    await openNewTree(page);
    await page.goto('./#/trees');
    await pick33kaku(page);
    await page.getByTestId('bundled-open').click();
    await expect(page.getByTestId('candidate')).toHaveCount(4);
    // ▲5八玉 → 自分の手番（確定した手）→ 相手の応手…とたどれる
    await page.getByTestId('candidate').first().click();
    await expect(page.getByTestId('mine-mark').first()).toBeVisible();
    await expect(page.getByTestId('mine-mark').first()).not.toHaveText('未検証');
    await page.getByTestId('candidate').first().click();
    await expect(page.getByTestId('candidate').first()).toBeVisible();
    await expect(page.getByTestId('crumb')).toHaveCount(2);
    // ここから展開のボタンが押せる（押すとプリセットを選ぶ。エンジンは動かさない）
    await expect(page.getByTestId('expand-here')).toBeEnabled();
    // 復習
    await page.getByTestId('crumb-start').click();
    await page.getByTestId('review-open').click();
    await expect(page.getByTestId('review-summary')).toContainText('問題');
    await expect(page.getByTestId('review-prompt')).toHaveAttribute('data-phase', 'ask');
  });

  test('一度開いた後は、通信なしでも開ける（コピーしたツリーも、新しいコピーも）', async ({ page, context }) => {
    await openNewTree(page);
    // service worker が担当するまで待ってから（公開版と同じ状態）
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      }
    });
    await page.goto('./#/trees');
    await page.reload();
    await pick33kaku(page);
    await page.getByTestId('bundled-open').click();
    await expect(page.getByTestId('candidate')).toHaveCount(4);
    // ファイルは端末に保存されている
    const cached = await page.evaluate(async (file) => {
      const cache = await caches.open('joban-tree-trees');
      return (await cache.keys()).map((r) => new URL(r.url).pathname).filter((p) => p.endsWith(file)).length;
    }, FILE);
    expect(cached).toBeGreaterThanOrEqual(1);

    await context.setOffline(true);
    await page.goto('./#/trees');
    await page.reload();
    await expect(page.getByTestId('tabbar')).toBeVisible();
    await page.getByTestId('tree-item').first().click();
    await expect(page.getByTestId('candidate')).toHaveCount(4);
    // 通信なしで新しくコピーもできる（端末に保存したファイルから）
    await page.goto('./#/trees');
    await pick33kaku(page);
    await page.getByTestId('bundled-copy-again').click();
    await expect(page.getByTestId('candidate')).toHaveCount(4);
    await page.goto('./#/trees');
    await expect(page.getByTestId('tree-item')).toHaveCount(2);
    await context.setOffline(false);
  });

  test('新しい版の知らせ（仕組み）：前の版のコピーだけがあると「新しい版があります」。開くと新しいコピーを作り、前のコピーは残す', async ({ page }) => {
    await openNewTree(page);
    await page.goto('./#/trees');
    // 前の版（版 0）のコピーがある状態を作る（取り込みで入れる）
    const file = JSON.parse(readFileSync(new URL(`../public/trees/${FILE}`, import.meta.url), 'utf8')) as BundledTreeFile;
    const old = {
      ...file.tree,
      version: TREE_FORMAT_VERSION,
      id: 'old-copy',
      name: '前の版のコピー',
      source: { kind: 'bundled', id: file.bundle.id, version: 0, finishedAt: 1 },
    };
    await page.getByTestId('import-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
    await expect(page.getByTestId('home-message')).toContainText('取り込みました');
    const oldItem = page.getByTestId('tree-item').filter({ hasText: '前の版のコピー' });
    await expect(oldItem.getByTestId('bundled-newer-chip')).toHaveText('新しい版あり');

    await pick33kaku(page);
    await expect(page.getByTestId('bundled-new-version')).toContainText('新しい版があります');
    // 前の版を開くこともできる
    await page.getByTestId('bundled-open-old').click();
    await expect(page).toHaveURL(/#\/tree\/old-copy$/);
    await page.goto('./#/trees');
    await pick33kaku(page);
    await page.getByTestId('bundled-open').click();
    await expect(page).toHaveURL(/#\/tree\/[\w-]+$/);
    expect(page.url()).not.toMatch(/old-copy$/);
    await page.goto('./#/trees');
    await expect(page.getByTestId('tree-item')).toHaveCount(2);
    await expect(oldItem).toHaveCount(1);
    // 新しい版のコピーができたので、知らせは消える
    await pick33kaku(page);
    await expect(page.getByTestId('bundled-new-version')).toHaveCount(0);
    await expect(page.getByTestId('bundled-copy-again')).toBeVisible();
  });
});
