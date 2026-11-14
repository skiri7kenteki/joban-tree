// 段階4-1：閲覧画面（スマホ縦で盤＋候補手 3 つが 1 画面に収まる、自分の対応の併記、枝の先の様子）
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type TreeData, type TreeNode } from '../src/tree/types';

const cp = (value: number) => ({ kind: 'cp' as const, value });

/**
 * prefix の後の局面（相手の手番）から、相手の応手を並べた小さなツリー。自分は相手の反対側。
 * replies：[応手, 最善手との差, 自分の対応（無ければ null）, 未検証か]
 */
function makeTree(id: string, prefix: string[], replies: [string, number, string | null, boolean][]): TreeData {
  let sfen = STARTPOS_SFEN;
  for (const m of prefix) sfen = applyUsiMove(sfen, m)!.sfen;
  const nodes: Record<string, TreeNode> = {};
  const add = (s: string, round: number) => (nodes[sfenKey(s)] ??= { key: sfenKey(s), sfen: s, round, edges: [] });
  const root = add(sfen, 0);
  root.searched = { movetimeMs: 1500, multiPV: 3, depth: 18, nodes: 1 };
  for (const [move, diff, reply, unverified] of replies) {
    const a = applyUsiMove(sfen, move)!.sfen;
    const me = add(a, 0);
    root.edges.push({ move, to: me.key, score: cp(100 - diff), diff });
    if (!reply) continue;
    const b = applyUsiMove(a, reply)!.sfen;
    add(b, 1);
    me.edges.push({ move: reply, to: sfenKey(b), score: cp(110 - diff), ...(unverified ? { unverified: true } : {}) });
  }
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id,
    name: `段階4 ${id}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    mySide: sfen.split(' ')[1] === 'w' ? 'black' : 'white',
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: prefix },
    nodes,
    settings: { totalMs: 120_000, movetimeMs: 1500, multiPV: 4, maxRounds: 4, maxNodes: 3000, windowCp: 300, replyMs: 1000, dubiousCp: 150 },
  };
}

/** 平手 ▲７六歩 の後。△３四歩（本線）・△８四歩（本線、対応は未検証）・△３二金（有力）・△９四歩（疑問手）・△１四歩（対応なし） */
const OPENING = makeTree('p4-opening', ['7g7f'], [
  ['3c3d', 0, '2g2f', false],
  ['8c8d', 20, '2g2f', true],
  ['4a3b', 90, '2g2f', false],
  ['9c9d', 200, '2g2f', false],
  ['1c1d', 220, null, false],
]);

async function openTree(page: Page, tree: TreeData) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tree)) });
  await expect(page.getByTestId('home-message')).toContainText('取り込みました');
  await page.goto(`./#/tree/${tree.id}`);
  await expect(page.getByTestId('candidate').first()).toBeVisible();
}

test.describe('スマホ縦（390×844）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('盤と候補手 3 行が、スクロールなしで見える', async ({ page }) => {
    await openTree(page, OPENING);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const header = await page.locator('.screen-header').boundingBox();
    const board = await page.getByTestId('board').boundingBox();
    const third = await page.getByTestId('candidate').nth(2).boundingBox();
    expect(header!.y).toBeGreaterThanOrEqual(0);
    expect(board!.y).toBeGreaterThan(header!.y);
    expect(third!.y + third!.height).toBeLessThanOrEqual(844);
    await expect(page.getByTestId('candidate').nth(2)).toBeInViewport({ ratio: 1 });
  });

  test('相手の応手の行に、自分の対応・ラベル（短く）・枝の先の様子が出る', async ({ page }) => {
    await openTree(page, OPENING);
    const rows = page.getByTestId('candidate');
    await expect(rows.nth(0)).toContainText('△３四歩');
    await expect(rows.nth(0).getByTestId('candidate-reply')).toHaveText('→ ▲２六歩');
    await expect(rows.nth(0)).toContainText('本線');
    await expect(rows.nth(0).getByTestId('candidate-ahead')).toHaveText('対応まで');
    // 評価値は自分の対応の後の値（+110）
    await expect(rows.nth(0)).toContainText('+110');
    // 未検証の対応には印
    await expect(rows.nth(1).getByTestId('candidate-reply')).toContainText('未検証');
    // 疑問手のラベルは短く、咎めまで
    await expect(rows.nth(3).locator('.chip-dubious')).toHaveText('疑問手');
    await expect(rows.nth(3).getByTestId('candidate-ahead')).toHaveText('咎めまで');
    // 自分の対応がまだ無い
    await expect(rows.nth(4).getByTestId('candidate-reply')).toHaveText('→ 未展開');
    // 行のタップは今までどおり 1 手進む
    await rows.nth(0).click();
    await expect(page.getByTestId('crumb')).toHaveText(['△３四歩']);
    await expect(rows.first()).toContainText('▲２六歩');
    // 「‹」で 1 手戻る
    await page.getByTestId('nav-back').click();
    await expect(page.getByTestId('crumb')).toHaveCount(0);
    await expect(page.getByTestId('nav-back')).toBeDisabled();
  });

  test('盤上に候補手の矢印・丸印は描かない（持ち主の判断 2026-11-14）', async ({ page }) => {
    await openTree(page, OPENING);
    // 盤の上の図形は、駒 40 枚の五角形と星 4 つだけ
    await expect(page.locator('[data-testid="board"] polygon')).toHaveCount(40);
    await expect(page.locator('[data-testid="board"] circle')).toHaveCount(4);
  });
});

test.describe('iPad 横（1180×820）', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

  test('盤と候補手リストを左右に並べたまま', async ({ page }) => {
    await openTree(page, OPENING);
    const board = await page.getByTestId('board').boundingBox();
    const list = await page.locator('.candidates').boundingBox();
    expect(board!.x + board!.width).toBeLessThanOrEqual(list!.x);
    expect(list!.y).toBeLessThan(board!.y + board!.height / 2);
    await expect(page.getByTestId('candidate').nth(4)).toBeInViewport({ ratio: 1 });
  });
});

// ---- 段階4-2：そのほかの画面の手直し ----

test.describe('4-2 スマホ縦（390×844）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('入力画面：作るボタンは画面の下に固定され、盤の操作と重ならない', async ({ page }) => {
    await page.goto('./#/new');
    await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
    await expect(page.getByTestId('start-normal')).toBeInViewport({ ratio: 1 });
    const bar = (await page.getByTestId('start-bar').boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(844 + 1);
    // 開いたときは、盤も手順の操作もバーの上（重なっていない）
    const board = (await page.getByTestId('board').boundingBox())!;
    expect(board.y + board.height).toBeLessThanOrEqual(bar.y);
    const nav = (await page.getByTestId('input-next').boundingBox())!;
    expect(nav.y + nav.height).toBeLessThanOrEqual(bar.y);
    // 貼り付け欄を開いても、作るボタンは押せる
    await page.getByTestId('kifu-open').click();
    await expect(page.getByTestId('start-normal')).toBeInViewport({ ratio: 1 });
    // いちばん下までスクロールしても、手順の操作はバーに隠れない
    await page.mouse.wheel(0, 3000);
    await expect(page.getByTestId('input-next')).toBeInViewport({ ratio: 1 });
    const next = (await page.getByTestId('input-next').boundingBox())!;
    const bar2 = (await page.getByTestId('start-bar').boundingBox())!;
    expect(next.y + next.height).toBeLessThanOrEqual(bar2.y);
  });

  test('一覧：自分の側と、開始局面までの最後の数手。速度測定は設定画面へ', async ({ page }) => {
    await openTree(page, makeTree('p42-list', ['7g7f', '3c3d', '2g2f', '8c8d'], [['2f2e', 0, null, false]]));
    await page.goto('./');
    await expect(page.getByTestId('tree-item-position')).toHaveText('自分：☖後手・…△３四歩 ▲２六歩 △８四歩');
    await expect(page.getByText('エンジンの速度測定')).toHaveCount(0);
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('open-bench')).toHaveAttribute('href', /bench\.html$/);
  });

  test('復習：相手が直前に指した手を、盤（最終手のマス）と一言で示す。記録を消すは画面の下', async ({ page }) => {
    await openTree(page, OPENING);
    await page.getByTestId('review-open').click();
    await expect(page.getByTestId('review-prompt')).toHaveAttribute('data-phase', 'ask');
    const said = await page.getByTestId('review-opponent').innerText();
    expect(said).toMatch(/^相手は △/);
    // 盤の最終手のマス（行き先）と元のマスに印
    await expect(page.locator('[data-testid="board"] .sq-last')).toHaveCount(1);
    await expect(page.locator('[data-testid="board"] .sq-last-from')).toHaveCount(1);
    // 「記録を消す…」は盤と問題の下
    const clear = (await page.getByTestId('review-clear').boundingBox())!;
    const prompt = (await page.getByTestId('review-prompt').boundingBox())!;
    const line = (await page.getByTestId('review-line').boundingBox())!;
    expect(clear.y).toBeGreaterThan(prompt.y + prompt.height);
    expect(clear.y).toBeGreaterThan(line.y + line.height);
  });
});

test.describe('4-2 iPad 横（1180×820）', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

  test('入力画面：左に盤、右に貼り付け・手順の操作・作るボタン（盤に重ならない）', async ({ page }) => {
    await page.goto('./#/new');
    await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
    const board = (await page.getByTestId('board').boundingBox())!;
    const start = (await page.getByTestId('start-normal').boundingBox())!;
    const paste = (await page.getByTestId('kifu-open').boundingBox())!;
    expect(board.x + board.width).toBeLessThanOrEqual(start.x);
    expect(board.x + board.width).toBeLessThanOrEqual(paste.x);
    await expect(page.getByTestId('start-normal')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('board')).toBeInViewport({ ratio: 1 });
  });
});
