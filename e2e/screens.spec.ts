// 画面を撮るだけのテスト（見た目の確かめ用。2026-11-25 開発環境の整備）。
// SHOTS があるときだけ動く（ふだんのテストと GitHub Actions では飛ばす）。
//   bash：SHOTS=1 npx playwright test e2e/screens.spec.ts
//   PowerShell：$env:SHOTS=1; npx playwright test e2e/screens.spec.ts
// 保存先は screenshots/<大きさ>-<画面>.png（.gitignore 済み）。新しい画面を作ったら、ここに撮る画面を足す
import { openSettings } from './settings';
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import type { Study } from '../src/tree/types';
import { openStudyList } from './study-list';

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
      await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${STUDIES.length} 本`);
      await shot(page, size.name, 'studies');
      // 段階22-4：定跡帳の ⋯ の研究手順の一覧
      await openStudyList(page);
      await shot(page, size.name, 'study-list');
      await page.goto('./#/');

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
      // 稽古の札の場面（はじめての手・まちがえた後・終わり。札の文の長さで盤が動かないかを見る）
      await page.goto('./#/practice/play/s-a');
      await page.reload();
      await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
      await shot(page, size.name, 'practice-first');
      const tapSquares = async (...squares: string[]) => {
        for (const square of squares) await page.locator(`[data-testid="practice-board"] [data-square="${square}"]`).click();
      };
      await tapSquares('93', '94');
      await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'wrong');
      await shot(page, size.name, 'practice-wrong');
      for (const [ply, from, to] of [[17, '51', '62'], [19, '71', '72'], [21, '63', '64']] as const) {
        await expect(page.getByTestId('practice-position')).toContainText(`${ply}手目`);
        await tapSquares(from, to);
      }
      await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'end');
      await shot(page, size.name, 'practice-end');

      // 実戦：将棋ウォーズの名前 → 棋譜を貼る → 結果 → 実戦のタブ
      await openSettings(page, 'games');
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

      // 設定のタブと下の画面
      await openSettings(page);
      await shot(page, size.name, 'settings');
      for (const sub of ['practice', 'games', 'engine', 'sync', 'data'] as const) {
        await openSettings(page, sub);
        await shot(page, size.name, `settings-${sub}`);
      }
      await expect(page.getByTestId('backup-save')).toBeEnabled();
      // 段階22-2：ほかの端末のバックアップを合わせる確認の窓（1 本足して 1 本消すファイル）
      // backupFile.ts は読み込まない（Vite 専用の書き方の templates.ts につながり、Playwright が起動できなくなる）
      const gone = STUDIES[1];
      const incoming = {
        app: 'joban-tree',
        kind: 'backup',
        version: 1,
        createdAt: Date.now(),
        appVersion: '0.50.0',
        data: {
          studies: [{ ...gone, id: 's-new', name: 'ほかの端末で足した研究', moves: [...G1, '5i5h', '3a2b'] }],
          deleted: [{ kind: 'study', id: gone.id, at: Date.now() + 60_000, moves: gone.moves, side: gone.mySide }],
        },
      };
      await page.getByTestId('backup-merge-file').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(incoming)) });
      await expect(page.getByTestId('backup-merge-summary')).toBeVisible();
      await shot(page, size.name, 'merge');
      await page.getByTestId('backup-merge-dialog').getByRole('button', { name: 'やめる' }).click();
      await page.getByTestId('backup-merge').scrollIntoViewIfNeeded();
      await shot(page, size.name, 'settings-data-bottom');
      // 前の同期から 1 日以上の一言（定跡帳のタブ）
      await page.evaluate(() => localStorage.setItem('joban-tree.last-sync', String(Date.now() - 2 * 24 * 60 * 60 * 1000)));
      await page.goto('./#/');
      await page.reload();
      await expect(page.getByTestId('sync-nudge')).toBeVisible();
      await shot(page, size.name, 'sync-nudge');
      // 段階22-4：手順前後で合流した定跡帳（平手から）
      await page.getByTestId('study-import-file').setInputFiles({
        name: 't.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({
            app: 'joban-tree',
            kind: 'studies',
            version: 1,
            studies: [
              { id: 's-t1', name: '角道から組む形', note: '', moves: ['7g7f', '3c3d', '2g2f', '8c8d'], mySide: 'black', createdAt: 5, updatedAt: 5 },
              { id: 's-t2', name: '飛車先から組む形', note: '', moves: ['2g2f', '3c3d', '7g7f', '4c4d', '2f2e'], mySide: 'black', createdAt: 4, updatedAt: 4 },
            ],
          }),
        ),
      });
      await expect(page.getByTestId('study-count')).toHaveText('研究手順 5 本');
      await shot(page, size.name, 'studies-groups');
      await page.goto(`./#/book/${encodeURIComponent('study:hirate|black')}/s-t1/3`);
      await expect(page.getByTestId('book-transposed-tag')).toBeVisible();
      await shot(page, size.name, 'book-transposed');
      await page.getByTestId('study-book-branch').filter({ hasText: '飛車先から' }).click();
      await expect(page.getByTestId('book-toast')).toBeVisible();
      await shot(page, size.name, 'book-switched');
    });

    test(`${size.name}：戦型を選ぶ・作る（段階25-1）`, async ({ page }) => {
      await page.goto('./');
      await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
      await page.goto('./#/study-import');
      // 角換わりの形。13 手目で分かれる 2 本
      const mv = (n: number, m: string) => `${n} ${m}`;
      const kif = [
        '手合割：平手',
        '手数----指手---------消費時間--',
        ...['７六歩(77)', '８四歩(83)', '２六歩(27)', '８五歩(84)', '７七角(88)', '３四歩(33)', '８八銀(79)', '３二金(41)', '７八金(69)', '７七角成(22)', '同　銀(88)', '４二銀(31)', '４八銀(39)', '７二銀(71)', '４六歩(47)'].map(
          (m, i) => mv(i + 1, m),
        ),
        '',
        '変化：13手',
        mv(13, '３八銀(39)'),
        mv(14, '７二銀(71)'),
        mv(15, '２七銀(38)'),
      ].join('\n');
      await page.getByTestId('kif-bulk-input').fill(kif);
      await page.getByTestId('kif-bulk-read').click();
      await shot(page, size.name, 'import-template-row');
      await page.getByTestId('kif-bulk-template').click();
      await shot(page, size.name, 'import-template-pick');
      await page.getByTestId('import-pick-new').click();
      await page.getByTestId('import-create-group').fill('角換わり');
      await shot(page, size.name, 'import-template-create');
      await page.getByTestId('import-create-ok').scrollIntoViewIfNeeded();
      await shot(page, size.name, 'import-template-create-bottom');
      await page.getByTestId('import-create-ok').click();
      await shot(page, size.name, 'import-template-chosen');
      // 戦型を作らずに取り込み、定跡帳の ⋯ から登録する
      await page.getByTestId('kif-bulk-template').click();
      await page.getByTestId('import-pick-auto').click();
      await page.getByTestId('kif-bulk-import').click();
      // 段階25-2：取り消すボタンと確認の窓
      await expect(page.getByTestId('import-undo')).toBeVisible();
      await shot(page, size.name, 'import-undo');
      await page.getByTestId('import-undo').click();
      await shot(page, size.name, 'import-undo-confirm');
      await page.getByTestId('import-undo-dialog').getByRole('button', { name: 'やめる' }).click();
      await page.getByTestId('book-group-open').first().click();
      // 段階25-2：研究手順の一覧の「選んで消す」
      await page.getByTestId('book-menu').click();
      await page.getByTestId('book-study-list').click();
      await page.getByTestId('study-select').click();
      await page.getByTestId('study-select-item').first().click();
      await shot(page, size.name, 'study-list-select');
      await page.getByTestId('study-select-delete').click();
      await shot(page, size.name, 'study-list-delete-confirm');
      await page.getByTestId('study-bulk-dialog').getByRole('button', { name: 'やめる' }).click();
      await page.getByTestId('study-list-dialog').getByRole('button', { name: '閉じる' }).click();
      for (let i = 0; i < 12; i++) await page.getByRole('button', { name: '1手進む' }).click();
      await page.getByTestId('book-menu').click();
      await page.getByTestId('book-register-template').click();
      await page.getByTestId('template-group-input').fill('角換わり');
      await shot(page, size.name, 'book-register-template');
      await page.getByTestId('template-save').click();
      await shot(page, size.name, 'book-registered');
    });
  });
}
