// 段階18（v0.42.0）：実戦の照らし合わせ（持ち主の依頼書 stage18-prompt・判断 2026-11-23「おすすめの通りで」）
// - 貼る → 結果（相手が研究にない手・研究通り 20 手目まで）→ この局面から研究を足す（定跡帳で指す）→ 結果が変わる（研究の先まで）
// - 同じ棋譜をもう一度貼ると「もう入っています」。自分の側はユーザー名で決まる・決まらなければ選ぶ
// - 一覧の集計・次に研究する所・⋯ で消す。タブは 定跡帳／復習／実戦／設定、ツリーは設定から
// - 結果の画面も 1 画面に収める
import { openSettings } from './settings';
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true });

const LINES = [
  '７六歩(77)', '３四歩(33)', '２六歩(27)', '８四歩(83)', '２五歩(26)', '８五歩(84)', '７八金(69)', '３二金(41)', '２四歩(25)', '２四歩(23)',
  '２四飛(28)', '８六歩(85)', '８六歩(87)', '８六飛(82)', '３四飛(24)', '３三角(22)', '５八玉(59)', '６二玉(51)', '３六歩(37)', '８二歩打',
  '３七桂(29)', '８八飛成(86)', '８八銀(79)',
];
const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c 5i5h 5a6b 3g3f P*8b 2i3g 8f8h+ 7i8h'.split(' ');

/** 将棋ウォーズからコピーした棋譜と同じ形（対局者名は仮のもの） */
function kif(opts: { date?: string; sente?: string; gote?: string; lines?: string[] } = {}): string {
  const lines = opts.lines ?? LINES;
  return [
    `開始日時：${opts.date ?? '2026/11/08 11:57:50'}`,
    '場所：将棋ウォーズ',
    '持ち時間：3分切れ負け',
    '手合割：平手',
    `先手：${opts.sente ?? 'sente_user'}`,
    '先手段級：七段',
    `後手：${opts.gote ?? 'Gote_User'}`,
    '後手段級：六段',
    '手数----指手---------消費時間--',
    ...lines.map((m, i) => `${i + 1} ${m}   ( 0:01/00:00:01)`),
    `${lines.length + 1} 投了`,
  ].join('\n');
}

const RESEARCH: Study = {
  id: 's-research',
  name: '青野流 △6二玉型',
  note: '',
  moves: [...G1.slice(0, 20), '3i3h', '7a7b'],
  mySide: 'white',
  createdAt: 1,
  updatedAt: 1,
};

async function setup(page: Page, studies: Study[] = [RESEARCH]) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
  });
  await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${studies.length} 本`);
}

async function setWarsName(page: Page, name: string) {
  await openSettings(page, 'games');
  await page.getByTestId('wars-name').fill(name);
  await page.getByTestId('wars-name').press('Tab');
}

async function paste(page: Page, text: string) {
  // 結果の画面（タブが無い）からも移れるように URL で
  await page.goto('./#/games');
  await page.getByTestId('games-paste').click();
  await page.getByTestId('games-paste-text').fill(text);
}

test('タブは 定跡帳／稽古／実戦／設定（段階19 で復習→稽古）。ツリーは設定の「ツリー（以前の機能）」から', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await expect(page.locator('.tabbar-label')).toHaveText(['定跡帳', '稽古', '実戦', '設定']);
  await page.getByTestId('tab-games').click();
  await expect(page.getByTestId('games-empty')).toBeVisible();
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('settings-row-trees').click();
  await page.getByTestId('open-trees').click();
  await expect(page.getByTestId('new-tree')).toBeVisible();
  await expect(page.getByTestId('tab-settings')).toHaveAttribute('aria-current', 'page');
  await page.getByTestId('trees-back').click();
  await expect(page.getByTestId('open-trees')).toBeVisible();
});

test('貼る → 結果 → この局面から研究を足す → 結果が変わる', async ({ page }) => {
  await setup(page);
  await setWarsName(page, 'gote_user');
  await paste(page, kif());
  await expect(page.getByTestId('games-paste-side-auto')).toContainText('☖後手');
  await page.getByTestId('games-paste-ok').click();

  // 結果：相手が研究にない手（21 手目 ▲3七桂）。研究通り 20 手目まで。盤は外れた局面
  await expect(page.getByTestId('game-kind')).toHaveAttribute('data-kind', 'opp');
  await expect(page.getByTestId('game-matched')).toHaveText('研究通り 20手目まで');
  await expect(page.getByTestId('game-position')).toContainText('21手目');
  await expect(page.getByTestId('game-result')).toContainText('３八銀');
  await expect(page.getByTestId('game-title')).toContainText('sente_user 七段');
  await expect(page.getByTestId('game-title')).toContainText('☖後手');
  // 手順の一覧：研究通りの手に「研究」、外れた手に「研究にない」
  await page.getByTestId('game-position').click();
  await expect(page.locator('[data-testid="kifu-row"][data-ply="20"] .kifu-note')).toHaveText('研究');
  await expect(page.locator('[data-testid="kifu-row"][data-ply="21"] .kifu-note')).toHaveText('研究にない');
  await page.locator('[data-testid="kifu-row"][data-ply="21"]').click();

  // 研究を足す：定跡帳がその局面（研究の木の外）で開く。後手の手（△8八飛成）を指すと研究手順に足される
  await page.getByTestId('game-add-research').click();
  await expect(page.getByTestId('book-head-empty')).toContainText('21手目。指すと研究に足します');
  await expect(page.getByTestId('study-position')).toContainText('21手目');
  await page.locator('[data-square="86"]').click();
  await page.locator('[data-square="88"]').click();
  await page.getByRole('button', { name: '成る', exact: true }).click();
  await expect(page.getByTestId('book-toast')).toContainText('を足しました');

  // 実戦の画面へ戻ると、結果が変わっている（研究の先まで・22 手目まで）
  await page.getByRole('button', { name: '‹ 一覧' }).click();
  await expect(page.getByTestId('game-kind')).toHaveAttribute('data-kind', 'beyond');
  await expect(page.getByTestId('game-matched')).toHaveText('研究通り 22手目まで');

  // 同じ棋譜をもう一度貼ると、増やさない
  await paste(page, kif());
  await expect(page.getByTestId('games-paste-same')).toBeVisible();
  await expect(page.getByTestId('games-paste-ok')).toBeDisabled();
});

test('一覧：集計・次に研究する所（回数の多い順）・自分の側を選ぶ・消す', async ({ page }) => {
  await setup(page);
  // ユーザー名が無いので、自分の側を選ぶ
  await paste(page, kif({ date: '2026/11/08 11:57:50' }));
  await expect(page.getByTestId('games-paste-ok')).toBeDisabled();
  await page.getByTestId('games-paste-side-white').click();
  await page.getByTestId('games-paste-ok').click();
  await expect(page.getByTestId('game-kind')).toHaveAttribute('data-kind', 'opp');
  await paste(page, kif({ date: '2026/11/09 10:00:00', sente: 'other_user' }));
  await page.getByTestId('games-paste-side-white').click();
  await page.getByTestId('games-paste-ok').click();
  await expect(page.getByTestId('game-kind')).toHaveAttribute('data-kind', 'opp');
  // 3 手目 ▲6六歩：最初から研究の外
  await paste(page, kif({ date: '2026/11/10 10:00:00', lines: ['７六歩(77)', '３四歩(33)', '６六歩(67)', '８四歩(83)'] }));
  await page.getByTestId('games-paste-side-white').click();
  await page.getByTestId('games-paste-ok').click();
  await expect(page.getByTestId('game-kind')).toHaveAttribute('data-kind', 'outside');
  await expect(page.getByTestId('game-matched')).toHaveText('3手目から研究の外');

  await page.goto('./#/games');
  await expect(page.getByTestId('game-item')).toHaveCount(3);
  await expect(page.getByTestId('game-item').first()).toHaveAttribute('data-kind', 'outside');
  await expect(page.getByTestId('games-summary-count')).toContainText('3');
  await expect(page.getByTestId('games-summary-average')).toContainText('20.0');
  await expect(page.getByTestId('games-summary-opp')).toContainText('2');
  await expect(page.getByTestId('next-spot')).toHaveCount(1);
  await expect(page.getByTestId('next-spot')).toContainText('21手目');
  await expect(page.getByTestId('next-spot-count')).toContainText('2');

  // 次に研究する所を押すと、定跡帳がその局面で開く
  await page.getByTestId('next-spot').click();
  await expect(page.getByTestId('study-position')).toContainText('21手目');
  await page.getByRole('button', { name: '‹ 一覧' }).click();

  // ⋯ で消す
  await page.getByTestId('game-menu').first().click();
  await page.getByTestId('game-delete').click();
  await page.getByTestId('game-delete-ok').click();
  await expect(page.getByTestId('game-item')).toHaveCount(2);
});

test('自分が研究と違う手：研究の手と実戦の手を並べ、研究の手を確かめる', async ({ page }) => {
  const other: Study = { ...RESEARCH, id: 's-other', moves: [...G1.slice(0, 17), '5a5b', '3g3f'] };
  await setup(page, [other]);
  await paste(page, kif());
  await page.getByTestId('games-paste-side-white').click();
  await page.getByTestId('games-paste-ok').click();
  await expect(page.getByTestId('game-kind')).toHaveAttribute('data-kind', 'mine');
  await expect(page.getByTestId('game-matched')).toHaveText('研究通り 17手目まで');
  await expect(page.getByTestId('game-compare')).toContainText('５二玉');
  await expect(page.getByTestId('game-compare')).toContainText('６二玉');
  await page.getByTestId('game-check-research').click();
  await expect(page.getByTestId('study-position')).toContainText('17手目');
});

for (const [w, h] of [
  [360, 640],
  [390, 844],
  [1180, 820],
] as [number, number][]) {
  test(`${w}×${h}：結果の画面はページ全体がスクロールしない`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page);
    await paste(page, kif());
    await page.getByTestId('games-paste-side-white').click();
    await page.getByTestId('games-paste-ok').click();
    await expect(page.getByTestId('game-kind')).toHaveAttribute('data-kind', 'opp');
    await page.waitForTimeout(300);
    const el = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, client: document.scrollingElement!.clientHeight }));
    expect(el.scroll).toBeLessThanOrEqual(el.client);
    const bar = (await page.getByTestId('game-nav').boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(h);
    if (w < h) {
      // スマホ縦：結果のカード（研究を足すボタン）まで画面の中
      const btn = (await page.getByTestId('game-add-research').boundingBox())!;
      expect(btn.y + btn.height).toBeLessThanOrEqual(h);
    }
  });
}
