// 画面の通し確認（段階3）：復習モード
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type TreeData, type TreeNode } from '../src/tree/types';

const SEARCHED = { movetimeMs: 1000, multiPV: 1, depth: 10, nodes: 1000 };

/** 自分は後手。平手 → ▲７六歩 → △３四歩（確定）／▲２六歩 → △８四歩（確定） */
function reviewTree(): TreeData {
  const nodes: Record<string, TreeNode> = {};
  const add = (moves: string[], round: number): TreeNode => {
    let sfen = STARTPOS_SFEN;
    for (const m of moves) sfen = applyUsiMove(sfen, m)!.sfen;
    const key = sfenKey(sfen);
    nodes[key] ??= { key, sfen, round, edges: [] };
    return nodes[key];
  };
  const root = add([], 0);
  for (const [opp, mine] of [
    ['7g7f', '3c3d'],
    ['2g2f', '8c8d'],
  ]) {
    const me = add([opp], 0);
    const next = add([opp, mine], 1);
    root.edges.push({ move: opp, to: me.key, score: { kind: 'cp', value: -30 }, diff: 0 });
    me.edges.push({ move: mine, to: next.key, score: { kind: 'cp', value: -30 } });
    me.searched = SEARCHED;
  }
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id: 'e2e-review',
    name: '復習用',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    mySide: 'white',
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: [] },
    nodes,
    settings: { totalMs: 120_000, movetimeMs: 1500, multiPV: 3, maxRounds: 4, maxNodes: 3000, windowCp: 300, replyMs: 1000 },
  };
}

async function openReview(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('import-file').setInputFiles({
    name: 'tree.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(reviewTree())),
  });
  await page.getByTestId('tree-item').first().click();
  await page.getByTestId('review-open').click();
  await expect(page.getByTestId('review-prompt')).toHaveAttribute('data-phase', 'ask');
}

/** 盤のマスを 2 つタップして指す（例：'33' → '34'） */
async function play(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

/** 今の問題の正解（相手の応手から決まる） */
async function correctMove(page: Page): Promise<[string, string]> {
  const text = (await page.getByTestId('review-prompt').textContent()) ?? '';
  return text.includes('７六歩') ? ['33', '34'] : ['83', '84'];
}

test('復習モード：相手の応手が出て、盤で答える。まちがい → もう一度 → 正解。記録が残る', async ({ page }) => {
  await openReview(page);
  await expect(page.getByTestId('review-summary')).toContainText('問題 2（まだ 2');
  await expect(page.getByTestId('review-opponent')).toHaveText(/^相手は ▲(７六歩|２六歩)$/);
  await expect(page.getByTestId('review-prompt')).toContainText('あなた（☖後手）の手は？');

  // まちがえる（△１四歩）
  const [from, to] = await correctMove(page);
  await play(page, '13', '14');
  await expect(page.getByTestId('review-wrong')).toContainText('１四歩 ではありません');
  await page.getByTestId('review-retry').click();

  // 正解する → 少し見せてから、この手順の終わりへ
  await play(page, from, to);
  await expect(page.getByTestId('review-answer')).toContainText('正解！');
  await expect(page.getByTestId('review-end')).toContainText('1 問中 0 問、1 回目で正解');
  await expect(page.getByTestId('review-summary')).toContainText('まだ 1・前回まちがい 1');

  // 次の手順：まちがえた問題が選ばれやすい（重み 2：1）。正解を見るで進むこともできる
  await page.getByTestId('review-next').click();
  await expect(page.getByTestId('review-prompt')).toHaveAttribute('data-phase', 'ask');
  await play(page, '13', '14');
  await page.getByTestId('review-show').click();
  await expect(page.getByTestId('review-answer')).toContainText('正解は');
  await page.getByTestId('review-continue').click();
  await expect(page.getByTestId('review-end')).toBeVisible();

  // 開き直しても記録が残る
  await page.reload();
  await expect(page.getByTestId('review-summary')).toContainText('前回まちがい');

  // 記録を消す（確認あり）
  await page.getByTestId('review-clear').click();
  await page.getByTestId('review-clear-confirm').click();
  await expect(page.getByTestId('review-summary')).toContainText('問題 2（まだ 2・前回まちがい 0・覚えた 0）');
});

/** 自分は後手。平手 → ▲７六歩（疑問手）→ △３四歩 → ▲２六歩（本線）→ △８四歩。▲７六歩の先は深く出さない */
function dubiousTree(): TreeData {
  const tree = reviewTree();
  const nodes: Record<string, TreeNode> = {};
  const add = (moves: string[], round: number): TreeNode => {
    let sfen = STARTPOS_SFEN;
    for (const m of moves) sfen = applyUsiMove(sfen, m)!.sfen;
    const key = sfenKey(sfen);
    nodes[key] ??= { key, sfen, round, edges: [] };
    return nodes[key];
  };
  const line = ['7g7f', '3c3d', '2g2f', '8c8d'];
  for (let i = 0; i < line.length; i++) {
    const from = add(line.slice(0, i), Math.floor(i / 2));
    const to = add(line.slice(0, i + 1), Math.floor((i + 1) / 2));
    const opp = i % 2 === 0;
    from.edges.push({ move: line[i], to: to.key, score: { kind: 'cp', value: 200 }, ...(opp ? { diff: i === 0 ? 300 : 0 } : {}) });
    if (!opp) from.searched = SEARCHED;
  }
  return { ...tree, id: 'e2e-dubious', name: '疑問手の復習', rootKey: add([], 0).key, nodes };
}

test('復習モード：相手の疑問手には、咎める 1 手だけを出して手順を終える', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('import-file').setInputFiles({
    name: 'tree.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(dubiousTree())),
  });
  await page.getByTestId('tree-item').first().click();
  await page.getByTestId('review-open').click();
  // 問題は △３四歩 の 1 つだけ（▲７六歩△３四歩▲２六歩 の後の △８四歩 は数えない）
  await expect(page.getByTestId('review-summary')).toContainText('問題 1（まだ 1');
  await expect(page.getByTestId('review-dubious')).toHaveText('疑問手');
  await expect(page.getByTestId('review-opponent')).toHaveText('相手は ▲７六歩（疑問手）');
  await expect(page.getByTestId('review-prompt')).toContainText('どう咎めますか？');
  await play(page, '33', '34');
  await expect(page.getByTestId('review-answer')).toContainText('正解！');
  await expect(page.getByTestId('review-end')).toContainText('疑問手を咎める手まで出しました。この手順はここまでです（1 問中 1 問');
});
