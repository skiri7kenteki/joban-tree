// 段階21-1（v0.47.0）：自分の手の候補表（本命・次善・悪手）。持ち主の判断 2026-11-25「すべておすすめの通りで」
// - 定跡帳の行に印（本命・次善 −80・悪手 −450）、研究手順の無い手は薄い行、見出しの行は要約。候補の窓
// - 行の ⋯ で付け替え → 取り消し。研究手順が通っている手を悪手にするときは、消してから。悪手の印のある手は盤で指しても足さない
// - エンジンに聞くの［表に残す］・もう一度残す（確認）・盤で指して調べる（ENGINE_AVAILABLE=1 のときだけ）
// - 表があっても盤の大きさは変わらず、1 画面に収まる
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import type { Candidate } from '../src/tree/candidates';
import type { Study } from '../src/tree/types';

test.use({ hasTouch: true });

const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
/** 後手番。17手目 ▲5八玉 の後に △6二玉（A）と △5二玉（B） */
const A: Study = { id: 's-a', name: '青野流 △6二玉型', note: '', moves: [...G1, '5i5h', '5a6b', '3g3f', '7a7b'], mySide: 'white', createdAt: 2, updatedAt: 2 };
const B: Study = { id: 's-b', name: '青野流 △5二玉', note: '', moves: [...G1, '5i5h', '5a5b', '3g3f'], mySide: 'white', createdAt: 1, updatedAt: 1 };
const KEY = encodeURIComponent('study:横歩取り|white');
const AT17 = sfenKey(A.moves.slice(0, 17).reduce((sfen, m) => applyUsiMove(sfen, m)!.sfen, STARTPOS_SFEN));

const cp = (value: number) => ({ kind: 'cp' as const, value });
/** 本命 △6二玉・次善 △5二玉・悪手 △1四歩（研究手順なし。盤で指せる手） */
const TABLE: Candidate[] = [
  { move: '5a6b', mark: 'main', eval: cp(45), by: { engine: 'テスト', ms: 3000, at: 1 }, pv: ['3g3f', '7a7b'] },
  { move: '5a5b', mark: 'alt', eval: cp(-35), pv: ['3g3f'] },
  { move: '1c1d', mark: 'bad', eval: cp(-405), pv: ['3g3f', '1d1e'] },
];

async function setup(page: Page, studies: Study[]) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
  });
  await expect(page.getByTestId('study-item')).toHaveCount(studies.length);
}

/** 候補の表を端末の保存場所に直接入れる（エンジンを使わずに確かめる） */
async function putTable(page: Page, candidates: Candidate[]) {
  await page.evaluate(
    async ({ key, candidates }) => {
      const req = indexedDB.open('joban-tree');
      const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
      await new Promise<void>((r) => {
        const tx = db.transaction('positions', 'readwrite');
        tx.objectStore('positions').put({ id: `white|${key}`, side: 'white', key, note: '', candidates, updatedAt: 1 });
        tx.oncomplete = () => r();
      });
      db.close();
    },
    { key: AT17, candidates },
  );
}

async function openAt17(page: Page) {
  await page.goto(`./#/book/${KEY}/s-a/17`);
  await page.reload();
  await expect(page.getByTestId('study-position')).toContainText('17手目');
}

const tapMove = async (page: Page, from: string, to: string) => {
  await page.locator(`[data-testid="study-board"] [data-square="${from}"]`).click();
  await page.locator(`[data-testid="study-board"] [data-square="${to}"]`).click();
};

test('行の印と見出しの行の要約 → 候補の窓 → 行の ⋯ で付け替え → 取り消し', async ({ page }) => {
  await setup(page, [A, B]);
  await putTable(page, TABLE);
  await openAt17(page);

  await expect(page.getByTestId('book-table')).toHaveText('候補 3・本命 △６二玉');
  await expect(page.getByTestId('book-mark-tag')).toHaveText(['本命', '次善 −80', '悪手 −450']);
  // 段階21-2：読み筋のある悪手の行は「咎め方を見る」
  await expect(page.getByTestId('book-cand-row')).toContainText('咎め方を見る');
  await expect(page.getByTestId('book-conflict-tag')).toHaveCount(0);

  // 相手の手番には表を出さない
  await page.getByTestId('study-prev').click();
  await expect(page.getByTestId('book-table')).toHaveCount(0);
  await expect(page.getByTestId('book-mark-tag')).toHaveCount(0);
  await page.getByTestId('study-next').click();

  // 候補の窓：評価値と読み筋、いちばん下に局面メモ
  await page.getByTestId('book-table').click();
  const dialog = page.getByTestId('book-cand-dialog');
  await expect(dialog.getByTestId('cand-item')).toHaveCount(3);
  await expect(dialog.getByTestId('cand-item').first()).toContainText('+45 ▲３六歩 △７二銀');
  await expect(dialog.getByTestId('cand-item').last()).toContainText('咎め方：');
  await expect(dialog).toContainText('3秒・テスト');
  await expect(dialog.getByTestId('book-memo-text')).toBeVisible();
  await dialog.getByRole('button', { name: '閉じる' }).click();

  // △5二玉 を本命に（前の本命は次善）→ 取り消し
  await page.getByTestId('book-branch-menu').nth(1).click();
  await page.getByTestId('mark-main').click();
  await expect(page.getByTestId('book-toast')).toContainText('△５二玉 を本命にしました');
  await expect(page.getByTestId('book-table')).toHaveText('候補 3・本命 △５二玉');
  await page.getByTestId('book-toast-undo').click();
  await expect(page.getByTestId('book-table')).toHaveText('候補 3・本命 △６二玉');
  await expect(page.getByTestId('book-mark-tag')).toHaveText(['本命', '次善 −80', '悪手 −450']);

  // 薄い行の ⋯：理由を書く → 表から外す → 取り消し
  await page.getByTestId('book-cand-menu').click();
  await page.getByTestId('mark-reason').fill('端が間に合わない');
  await page.getByTestId('mark-reason-save').click();
  await page.getByTestId('book-table').click();
  await expect(dialog).toContainText('端が間に合わない');
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await page.getByTestId('book-cand-menu').click();
  await page.getByTestId('mark-remove').click();
  await expect(page.getByTestId('book-cand-row')).toHaveCount(0);
  await expect(page.getByTestId('book-table')).toHaveText('候補 2・本命 △６二玉');
  await page.getByTestId('book-toast-undo').click();
  await expect(page.getByTestId('book-cand-row')).toHaveCount(1);
});

test('悪手の印のある手は盤で指しても足さない。研究手順が通る手を悪手にするときは、消してから（取り消せる）', async ({ page }) => {
  await setup(page, [A, B]);
  await putTable(page, TABLE);
  await openAt17(page);

  await tapMove(page, '13', '14');
  await expect(page.getByTestId('study-screen-status')).toContainText('悪手にしているので、研究手順に足しません');
  await expect(page.getByTestId('study-book-head')).toHaveText('研究 2本');

  await page.getByTestId('book-branch-menu').nth(1).click();
  await page.getByTestId('mark-bad').click();
  await expect(page.getByTestId('book-bad-text')).toContainText('研究手順 1 本');
  await page.getByTestId('book-bad-ok').click();
  await expect(page.getByTestId('book-toast')).toContainText('△５二玉 を悪手にしました');
  await expect(page.getByTestId('study-book-branch')).toHaveCount(1);
  await expect(page.getByTestId('book-cand-row')).toHaveCount(2);

  await page.getByTestId('book-toast-undo').click();
  await expect(page.getByTestId('study-book-branch')).toHaveCount(2);
  await expect(page.getByTestId('book-mark-tag')).toHaveText(['本命', '次善 −80', '悪手 −450']);
});

for (const [w, h] of [
  [360, 640],
  [390, 844],
  [1180, 820],
] as [number, number][]) {
  test(`${w}×${h}：表があっても盤の大きさは同じで、1 画面に収まる`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setup(page, [A, B]);
    await openAt17(page);
    await page.waitForTimeout(400);
    const before = (await page.getByTestId('board').boundingBox())!;
    await putTable(page, TABLE);
    await page.reload();
    await expect(page.getByTestId('book-table')).toBeVisible();
    await page.waitForTimeout(400);
    const after = (await page.getByTestId('board').boundingBox())!;
    expect(after.width).toBeCloseTo(before.width, 0);
    const el = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, client: document.scrollingElement!.clientHeight, wide: document.scrollingElement!.scrollWidth }));
    expect(el.scroll).toBeLessThanOrEqual(el.client);
    expect(el.wide).toBeLessThanOrEqual(w);
    // 見出しの行は 1 行のまま
    const count = (await page.getByTestId('study-book-head').boundingBox())!;
    const ask = (await page.getByTestId('book-ask').boundingBox())!;
    const chip = (await page.getByTestId('book-table').boundingBox())!;
    expect(Math.abs(ask.y - chip.y)).toBeLessThan(4);
    expect(Math.abs(ask.y + ask.height / 2 - (count.y + count.height / 2))).toBeLessThan(6);
  });
}

test.describe('エンジンを使う', () => {
  test.skip(!process.env.ENGINE_AVAILABLE, 'エンジンがビルドされていないので省略（GitHub Actions では実行される）');
  test.setTimeout(150_000);

  test('［表に残す］→ 行に印 → もう一度残すと確認 → 盤で指して調べて残す → 取り消し', async ({ page }) => {
    await setup(page, [A, B]);
    await openAt17(page);
    await page.getByTestId('book-ask').click();
    const ask = page.getByTestId('ask-dialog');
    await expect(ask.getByTestId('ask-list')).toBeVisible({ timeout: 60_000 });
    await expect(ask.getByTestId('ask-mark').first()).toContainText('にする');
    await ask.getByTestId('ask-save').click();
    await expect(ask).toBeHidden();
    await expect(page.getByTestId('book-toast')).toContainText('候補の表に残しました');
    await expect(page.getByTestId('book-table')).toContainText('・本命 ');
    // 研究の手 2 つには印が付き、悪手にはならない
    await expect(page.getByTestId('study-book-branch').getByTestId('book-mark-tag')).toHaveCount(2);
    await expect(page.getByTestId('study-book-branch').locator('[data-mark="bad"]')).toHaveCount(0);

    // もう一度：確認してから書きかえる
    await page.getByTestId('book-ask').click();
    await expect(ask.getByTestId('ask-list')).toBeVisible({ timeout: 60_000 });
    await ask.getByTestId('ask-save').click();
    await expect(ask.getByTestId('ask-save-confirm')).toContainText('手・印・理由は残し');
    await ask.getByTestId('ask-save-ok').click();
    await expect(ask).toBeHidden();

    // 盤で指して調べる（△9四歩）
    await page.getByTestId('book-ask').click();
    await ask.getByTestId('ask-pick').click();
    await expect(page.getByTestId('pick-text')).toBeVisible();
    await tapMove(page, '93', '94');
    await expect(ask.getByTestId('ask-list')).toBeVisible({ timeout: 60_000 });
    await expect(ask.locator('[data-testid="ask-row"][data-move="9c9d"]')).toContainText('指した手');
    await ask.getByTestId('ask-save').click();
    await ask.getByTestId('ask-save-ok').click();
    await page.getByTestId('book-table').click();
    await expect(page.locator('[data-testid="cand-item"][data-move="9c9d"]')).toBeVisible();
    await page.getByTestId('book-cand-dialog').getByRole('button', { name: '閉じる' }).click();
    // 研究手順は増えていない
    await expect(page.getByTestId('study-book-head')).toHaveText('研究 2本');
    await page.getByTestId('book-toast-undo').click();
    await expect(page.getByTestId('book-toast')).toContainText('取り消しました');
    await page.getByTestId('book-table').click();
    await expect(page.locator('[data-testid="cand-item"][data-move="9c9d"]')).toHaveCount(0);
  });
});

test('手順前後の研究の手が 1 つだけの局面でも、研究の手として扱う（「手順前後」の行。表にあっても「研究手順なし」にしない）', async ({ page }) => {
  // ▲7六歩 △3四歩 ▲2六歩（X はここで終わる）と、▲2六歩 △3四歩 ▲7六歩 △3二金（Y）は同じ局面
  const x: Study = { id: 's-x', name: '研究X', note: '', moves: ['7g7f', '3c3d', '2g2f'], mySide: 'white', createdAt: 2, updatedAt: 2 };
  const y: Study = { id: 's-y', name: '研究Y', note: '', moves: ['2g2f', '3c3d', '7g7f', '4a3b'], mySide: 'white', createdAt: 1, updatedAt: 1 };
  await setup(page, [x, y]);
  await page.goto(`./#/book/${encodeURIComponent('study:hirate|white')}/s-x/3`);
  await expect(page.getByTestId('study-position')).toContainText('3手目');
  await expect(page.getByTestId('book-transposed')).toHaveCount(1);
  await expect(page.getByTestId('book-conflict-tag')).toHaveCount(0);

  await page.getByTestId('book-transposed-menu').click();
  await page.getByTestId('mark-main').click();
  await expect(page.getByTestId('book-transposed').getByTestId('book-mark-tag')).toHaveText('本命');
  await expect(page.getByTestId('book-cand-row')).toHaveCount(0);

  // 研究手順が通る手なので、悪手にするときは確認が出る
  await page.getByTestId('book-transposed-menu').click();
  await page.getByTestId('mark-bad').click();
  await expect(page.getByTestId('book-bad-text')).toContainText('研究Y');
});
