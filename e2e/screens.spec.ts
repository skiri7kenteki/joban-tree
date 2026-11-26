// 画面を撮るだけのテスト（見た目の確かめ用。2026-11-25 開発環境の整備）。
// SHOTS があるときだけ動く（ふだんのテストと GitHub Actions では飛ばす）。
//   bash：SHOTS=1 npx playwright test e2e/screens.spec.ts
//   PowerShell：$env:SHOTS=1; npx playwright test e2e/screens.spec.ts
// 保存先は screenshots/<大きさ>-<画面>.png（.gitignore 済み）。新しい画面を作ったら、ここに撮る画面を足す
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import type { Study } from '../src/tree/types';

test.skip(!process.env.SHOTS, '画面の撮影は SHOTS=1 のときだけ');
test.use({ hasTouch: true });
test.setTimeout(120_000);

/** 撮る大きさ（スマホ縦 2 つ・iPad 横） */
const SIZES = [
  { name: '360x640', width: 360, height: 640 },
  { name: '390x844', width: 390, height: 844 },
  { name: '1180x820', width: 1180, height: 820 },
];

// 研究手順（e2e/phase18・phase19 と同じもの）。横歩取り △3三角・後手番
const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
const STUDIES: Study[] = [
  { id: 's-a', name: '青野流 △6二玉型', note: '△6二玉から銀を上がる', moves: [...G1, '5i5h', '5a6b', '3g3f', '7a7b', '2i3g', '6c6d'], mySide: 'white', createdAt: 3, updatedAt: 3 },
  { id: 's-b', name: '青野流 △5二玉', note: '', moves: [...G1, '5i5h', '5a5b', '3g3f'], mySide: 'white', createdAt: 2, updatedAt: 2 },
  { id: 's-r', name: '青野流 △6二玉 △8二歩', note: '', moves: [...G1, '5i5h', '5a6b', '3g3f', 'P*8b', '3i3h', '7a7b'], mySide: 'white', createdAt: 1, updatedAt: 1 },
];
const KEY = encodeURIComponent('study:横歩取り|white');

/** 実戦の棋譜（将棋ウォーズからコピーした形。対局者名は仮のもの） */
const GAME = [
  '開始日時：2026/11/08 11:57:50',
  '場所：将棋ウォーズ',
  '持ち時間：3分切れ負け',
  '手合割：平手',
  '先手：sente_user',
  '先手段級：七段',
  '後手：gote_user',
  '後手段級：六段',
  '手数----指手---------消費時間--',
  ...[
    '７六歩(77)', '３四歩(33)', '２六歩(27)', '８四歩(83)', '２五歩(26)', '８五歩(84)', '７八金(69)', '３二金(41)', '２四歩(25)', '２四歩(23)',
    '２四飛(28)', '８六歩(85)', '８六歩(87)', '８六飛(82)', '３四飛(24)', '３三角(22)', '５八玉(59)', '６二玉(51)', '３六歩(37)', '８二歩打',
    '３七桂(29)', '８八飛成(86)', '８八銀(79)',
  ].map((m, i) => `${i + 1} ${m}   ( 0:01/00:00:01)`),
  '24 投了',
].join('\n');

async function shot(page: Page, size: string, screen: string) {
  await page.waitForTimeout(400); // 盤の大きさの測り直し・字体の読み込みを待つ
  await page.screenshot({ path: `screenshots/${size}-${screen}.png` });
}

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test(`${size.name}：定跡帳・稽古・実戦・設定`, async ({ page }) => {
      // 研究手順を入れる
      await page.goto('./');
      await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
      await page.getByTestId('study-import-file').setInputFiles({
        name: 's.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES })),
      });
      await expect(page.getByTestId('study-item')).toHaveCount(STUDIES.length);
      await shot(page, size.name, 'studies');

      // 定跡帳の盤（17 手目、分かれ目のある局面）
      await page.goto(`./#/book/${KEY}/s-a/17`);
      await expect(page.getByTestId('study-position')).toContainText('17手目');
      await shot(page, size.name, 'book');

      // 段階21-1：候補の表を直接入れて、行の印・候補の窓・行の ⋯
      const key = sfenKey(STUDIES[0].moves.slice(0, 17).reduce((sfen, m) => applyUsiMove(sfen, m)!.sfen, STARTPOS_SFEN));
      await page.evaluate(async (key) => {
        const req = indexedDB.open('joban-tree');
        const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
        const by = { engine: 'つようら王11micro', ms: 3000, at: Date.now() };
        await new Promise<void>((r) => {
          const tx = db.transaction('positions', 'readwrite');
          tx.objectStore('positions').put({
            id: `white|${key}`,
            side: 'white',
            key,
            note: '',
            candidates: [
              { move: '5a6b', mark: 'main', eval: { kind: 'cp', value: 45 }, by, pv: ['3g3f', '7a7b', '2i3g', '6c6d', '3i3h'], hard: true },
              { move: '5a5b', mark: 'alt', eval: { kind: 'cp', value: -35 }, by, pv: ['3g3f', '8f7f', '8h7g'] },
              { move: '1c1d', mark: 'bad', eval: { kind: 'cp', value: -405 }, by, pv: ['3g3f', '1d1e', '2i3g'], reason: '端が間に合わない' },
            ],
            updatedAt: 1,
          });
          tx.oncomplete = () => r();
        });
        db.close();
      }, key);
      await page.reload();
      await expect(page.getByTestId('book-table')).toBeVisible();
      await shot(page, size.name, 'book-table');
      await page.getByTestId('book-table').click();
      await shot(page, size.name, 'candidates');
      await page.getByTestId('book-cand-dialog').getByRole('button', { name: '閉じる' }).click();
      await page.getByTestId('book-branch-menu').nth(1).click();
      await shot(page, size.name, 'row-menu');
      await page.getByTestId('book-cut-dialog').getByRole('button', { name: '閉じる' }).click();
      // 段階21-2：咎め方を盤でたどる
      await page.getByTestId('book-cand-row').click();
      await page.getByTestId('study-next').click();
      await shot(page, size.name, 'refute');
      await page.getByTestId('refute-close').click();
      // 段階22-1：稽古で「成りますか？」（画面の下に重ねて出す）
      await page.goto('./#/practice/play/s-a');
      await page.reload();
      await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
      for (const square of ['33', '88']) await page.locator(`[data-testid="practice-board"] [data-square="${square}"]`).click();
      await expect(page.locator('.promote-box')).toBeVisible();
      await shot(page, size.name, 'practice-promote');
      // 稽古で次善・悪手
      for (const [name, to] of [
        ['practice-alt', ['51', '52']],
        ['practice-bad', ['13', '14']],
      ] as const) {
        await page.goto('./#/practice/play/s-a');
        await page.reload();
        await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
        for (const square of to) await page.locator(`[data-testid="practice-board"] [data-square="${square}"]`).click();
        await shot(page, size.name, name);
        if (name === 'practice-bad') {
          await expect(page.getByTestId('practice-refute-again')).toBeVisible({ timeout: 15_000 });
          await shot(page, size.name, 'practice-bad-back');
        }
      }
      await page.goto(`./#/book/${KEY}/s-a/17`);
      await expect(page.getByTestId('book-table')).toBeVisible();
      if (process.env.ENGINE_AVAILABLE) {
        await page.getByTestId('book-ask').click();
        await expect(page.getByTestId('ask-list')).toBeVisible({ timeout: 60_000 });
        await shot(page, size.name, 'ask-save');
        await page.getByTestId('ask-close').click();
      }

      // 稽古のタブと、稽古の盤（相手の手を指して、自分の手を答える所）
      await page.goto('./#/practice');
      await expect(page.getByTestId('practice-item').first()).toBeVisible();
      await shot(page, size.name, 'practice');
      await page.getByTestId('practice-start').first().click();
      await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
      await shot(page, size.name, 'practice-board');

      // 実戦：将棋ウォーズの名前 → 棋譜を貼る → 結果 → 実戦のタブ
      await page.goto('./#/settings');
      await page.getByTestId('wars-name').fill('gote_user');
      await page.getByTestId('wars-name').press('Tab');
      await page.goto('./#/games');
      await page.getByTestId('games-paste').click();
      await page.getByTestId('games-paste-text').fill(GAME);
      await page.getByTestId('games-paste-ok').click();
      await expect(page.getByTestId('game-kind')).toBeVisible();
      await shot(page, size.name, 'game-result');
      await page.goto('./#/games');
      await expect(page.getByTestId('games-empty')).toHaveCount(0);
      await shot(page, size.name, 'games');

      // 設定
      await page.goto('./#/settings');
      await expect(page.getByTestId('data-section')).toBeVisible();
      await shot(page, size.name, 'settings');
    });
  });
}
