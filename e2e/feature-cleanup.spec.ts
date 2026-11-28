// 機能の整理：消した画面の URL は定跡帳のタブを出す（壊れた画面を出さない）。整理-2：隠したものは画面に出ず、データは残る
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { openStudyList } from './study-list';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('ツリー・古い URL を開くと定跡帳のタブ。#/reviews は稽古のタブ', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  for (const path of ['trees', 'new', 'new/study', 'tree/abc', 'tree/abc/study/s-1/3', 'review/abc', 'review/abc/study', 'study/s-1', 'study/s-1/edit', 'study-review/s-1', 'study-review/group/x', 'settings-none']) {
    await page.goto('./#/practice');
    await expect(page.getByTestId('tab-practice')).toHaveAttribute('aria-current', 'page');
    await page.goto(`./#/${path}`);
    await expect(page.getByTestId('tab-studies'), path).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('study-register'), path).toBeVisible();
  }
  // 消した設定の下の画面は設定の目次
  await page.goto('./#/settings/trees');
  await expect(page.getByTestId('settings-row-engine')).toBeVisible();
  await page.goto('./#/reviews');
  await expect(page.getByTestId('tab-practice')).toHaveAttribute('aria-current', 'page');
  expect(errors).toEqual([]);
});

// ---- 整理-2：画面から隠したもの（データは残る） ----

const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
/** 後手番。メモは、欄で直せる 3000 字より長く、末尾に空白がある（取り込みや合流でできる形） */
const NOTE = `隠れる研究メモ${'あ'.repeat(3100)}  `;
const A = { id: 's-a', name: '青野流 △6二玉型', note: NOTE, moves: [...G1, '5i5h', '5a6b', '3g3f', '7a7b'], mySide: 'white', createdAt: 2, updatedAt: 2 };
const KEY = encodeURIComponent('study:横歩取り|white');
const AT17 = sfenKey(A.moves.slice(0, 17).reduce((sfen, m) => applyUsiMove(sfen, m)!.sfen, STARTPOS_SFEN));
const POSITION = {
  id: `white|${AT17}`,
  side: 'white',
  key: AT17,
  note: '隠れる局面メモ',
  candidates: [
    { move: '5a6b', mark: 'main' },
    { move: '1c1d', mark: 'bad', reason: '隠れる理由', pv: ['3g3f'] },
  ],
  updatedAt: 3,
};

/** 研究手順を入れる（JSON の取り込みのボタンは隠したが、ファイルを選ぶ欄と処理は残っている） */
async function setup(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [A] })),
  });
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 1 本');
  await page.evaluate(
    (record) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('joban-tree');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('positions', 'readwrite');
          tx.objectStore('positions').put(record);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
        };
      }),
    POSITION,
  );
  await page.reload();
}

const stored = (page: Page, store: string) =>
  page.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('joban-tree');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const r = open.result.transaction(name).objectStore(name).getAll();
          r.onsuccess = () => {
            open.result.close();
            resolve(r.result);
          };
        };
      }),
    store,
  );

/** 画面（開いている窓も）に、隠したメモ・理由の中身も、書く欄の言葉も出ていない */
const noHidden = async (page: Page, where: string) => {
  await expect(page.getByTestId('isolation'), where).not.toContainText(/隠れる|メモ|理由：/);
};
const close = (page: Page) => page.locator('dialog[open]').last().getByRole('button', { name: '閉じる' }).click();

test('登録の窓に基本の研究と JSON が無い。データ管理は合わせるが無く、書き出しは KIF だけ（コメントのメモは入る）', async ({ page }) => {
  await setup(page);
  await page.getByTestId('study-register').click();
  await expect(page.getByTestId('study-register-menu').locator('.dialog-actions-column .btn')).toHaveText([
    '平手から',
    '戦型から選ぶ',
    '棋譜を貼って 1 本登録',
    '変化付きKIFからまとめて',
  ]);
  await close(page);
  await page.goto('./#/settings/data');
  await expect(page.getByTestId('backup-restore')).toBeVisible();
  await expect(page.getByTestId('backup-merge')).toHaveCount(0);
  await expect(page.getByTestId('study-export-open')).toHaveText('研究手順を書き出す（KIF）');
  await page.getByTestId('study-export-open').click();
  await expect(page.getByTestId('study-export-json')).toHaveCount(0);
  const [kif] = await Promise.all([page.waitForEvent('download'), page.getByTestId('study-export-kif').click()]);
  expect(readFileSync((await kif.path())!, 'utf8')).toContain('隠れる研究メモ');
});

test('定跡帳と稽古に、研究手順のメモ・局面メモ・理由が出ない。名前を直してもメモは元のまま', async ({ page }) => {
  await setup(page);
  await noHidden(page, '一覧');
  await page.goto(`./#/book/${KEY}/s-a/17`);
  await expect(page.getByTestId('book-table')).toHaveText('候補');
  await expect(page.getByTestId('study-meta')).toHaveCount(0);
  await noHidden(page, '定跡帳');
  await page.getByTestId('book-table').click();
  await expect(page.getByTestId('cand-item')).toHaveCount(2);
  await expect(page.getByTestId('book-memo-text')).toHaveCount(0);
  await noHidden(page, '候補の窓');
  await close(page);
  await page.getByTestId('book-branch-menu').first().click();
  await expect(page.getByTestId('mark-main')).toBeVisible();
  await expect(page.getByTestId('mark-reason')).toHaveCount(0);
  await noHidden(page, '行の ⋯');
  await close(page);
  // 咎め方の枠にも理由を出さない
  await page.getByTestId('book-cand-row').click();
  await expect(page.getByTestId('refute-card')).toBeVisible();
  await noHidden(page, '咎め方');
  await page.getByTestId('refute-close').click();
  // 表の印を付け替えても、見えない局面メモと理由は残る → 取り消す
  await page.getByTestId('book-cand-menu').click();
  await page.getByTestId('mark-alt').click();
  await expect(page.getByTestId('book-toast')).toContainText('次善にしました');
  await expect.poll(async () => await stored(page, 'positions')).toMatchObject([{ note: POSITION.note, candidates: [{ move: '5a6b' }, { move: '1c1d', mark: 'alt', reason: '隠れる理由' }] }]);
  await page.getByTestId('book-toast-undo').click();
  await expect(page.getByTestId('book-cand-row')).toContainText('咎め方を見る');
  // 消す確認にも「メモも」と書かない
  await page.getByTestId('book-menu').click();
  await page.getByTestId('book-delete-study').click();
  await expect(page.getByTestId('book-delete-ok')).toBeVisible();
  await noHidden(page, '消す確認');
  await close(page);
  await page.getByTestId('book-menu').click();
  await expect(page.getByTestId('book-open-cand')).toHaveText('候補の表');
  await noHidden(page, '定跡帳の ⋯');
  await expect(page.getByTestId('book-edit-fields')).toHaveText('名前を直す');
  await page.getByTestId('book-edit-fields').click();
  await expect(page.getByTestId('study-note')).toHaveCount(0);
  await page.getByTestId('study-name').fill('直した名前');
  await page.getByTestId('study-save').click();
  await expect(page.getByTestId('study-title')).toHaveText('直した名前');
  // 相手の手番の ⋯ には、局面の窓の入口が無い
  await page.getByTestId('study-prev').click();
  await page.getByTestId('book-menu').click();
  await expect(page.getByTestId('book-register-template')).toBeVisible();
  await expect(page.getByTestId('book-open-cand')).toHaveCount(0);
  await close(page);
  const list = await openStudyList(page);
  await expect(list.getByTestId('study-item')).toContainText('直した名前');
  await expect(list.getByTestId('study-item-note')).toHaveCount(0);

  // 稽古：悪手の理由も、札の下の局面メモも、終わりの研究手順のメモも出ない
  await page.goto('./#/practice/play/s-a');
  const card = page.getByTestId('practice-card');
  const play = async (from: string, to: string) => {
    await page.locator(`[data-testid="practice-board"] [data-square="${from}"]`).click();
    await page.locator(`[data-testid="practice-board"] [data-square="${to}"]`).click();
  };
  await expect(card).toHaveAttribute('data-phase', 'ask');
  await play('93', '94');
  await expect(card).toHaveAttribute('data-phase', 'wrong');
  await noHidden(page, '稽古のまちがい');
  await page.reload();
  await expect(card).toHaveAttribute('data-phase', 'ask');
  await play('13', '14');
  await expect(card).toHaveAttribute('data-phase', 'bad');
  await noHidden(page, '稽古の悪手');
  await expect(page.getByTestId('practice-refute-again')).toBeVisible({ timeout: 15_000 });
  await play('51', '62');
  await expect(page.getByTestId('practice-position')).toContainText('19手目');
  await play('71', '72');
  await expect(card).toHaveAttribute('data-phase', 'end');
  await expect(page.getByTestId('practice-book')).toBeVisible();
  await noHidden(page, '稽古の終わり');

  // データは残っている。名前を直してもメモは変わらない（末尾の空白も）
  const studies = (await stored(page, 'studies')) as { name: string; note: string }[];
  expect(studies.map((s) => [s.name, s.note])).toEqual([['直した名前', NOTE]]);
  expect(await stored(page, 'positions')).toMatchObject([{ note: POSITION.note, candidates: POSITION.candidates }]);
});
