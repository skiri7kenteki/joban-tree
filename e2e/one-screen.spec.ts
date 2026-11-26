// 段階14（v0.38.0）：盤の画面は 1 画面に収める（持ち主の依頼 stage14-prompt・判断 2026-11-22「おすすめの通りで」）
// - スマホ縦 4 つの大きさと iPad 横で、盤の画面（定跡帳の盤・ツリー・新しいツリー・復習）のページ全体がスクロールしない
// - 上から 見出し → 盤 → 操作バー → 一覧の枠。盤と操作バーは画面の中、一覧の枠の中だけスクロールする
// 今後の変更でこのテストが落ちたら、見た目の方を直す（DESIGN.md の「画面の決まり」）
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type Study, type TreeData, type TreeNode } from '../src/tree/types';
import { openStudyList } from './study-list';

test.use({ hasTouch: true });

const base = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b';
const mk = (id: string, name: string, tail: string, updatedAt: number): Study => ({
  id,
  name,
  note: `${name}のメモ。長めのメモでも、盤の画面には全文を出さない（★ の行を押すと開く）`,
  moves: `${base} ${tail}`.split(' '),
  mySide: 'black',
  createdAt: 1,
  updatedAt,
});
/** 8 手目（△3二金 の後）で 4 つに分かれる（一覧の枠に入りきらないことがある数） */
const STUDIES: Study[] = [
  mk('s-a', '研究A', '2e2d 2c2d', 9),
  mk('s-b', '研究B', '3i3h 7a7b', 8),
  mk('s-c', '研究C', '9g9f 9c9d', 7),
  mk('s-d', '研究D', '1g1f 1c1d', 6),
];

/** 開始局面（▲7六歩の後）で相手の応手 4 つ、それぞれに自分の対応 1 つ */
function tree(): TreeData {
  const sfen = applyUsiMove(STARTPOS_SFEN, '7g7f')!.sfen;
  const nodes: Record<string, TreeNode> = {};
  const add = (s: string) => (nodes[sfenKey(s)] ??= ({ key: sfenKey(s), sfen: s, round: 0, edges: [] }) as TreeNode);
  const root = add(sfen);
  const link = (from: TreeNode, m: string, cp: number, diff?: number) => {
    const to = add(applyUsiMove(from.sfen, m)!.sfen);
    from.edges.push({ move: m, to: to.key, score: { kind: 'cp', value: cp }, ...(diff !== undefined ? { diff } : {}) } as never);
    return to;
  };
  for (const [m, cp, diff] of [
    ['3c3d', 40, 0],
    ['8c8d', 60, 20],
    ['4c4d', 90, 60],
    ['5c5d', 160, 170],
  ] as [string, number, number][]) {
    link(link(root, m, cp, diff), '2g2f', cp);
  }
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id: 'one-tree',
    name: '▲7六歩からの対策',
    createdAt: 1,
    updatedAt: 1,
    mySide: 'black',
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: ['7g7f'] },
    nodes,
    settings: { totalMs: 120_000, movetimeMs: 1500, multiPV: 4, maxRounds: 4, maxNodes: 3000, windowCp: 300, replyMs: 1000, dubiousCp: 150 },
  } as TreeData;
}

async function setup(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES })),
  });
  await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${STUDIES.length} 本`);
  await page.goto('./#/trees');
  await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tree())) });
  await expect(page.getByTestId('tree-item')).toHaveCount(1);
}

/** ページ全体がスクロールしない。盤（持ち駒の行も）と操作バーが画面の中で、操作バーは盤のすぐ下 */
async function expectOneScreen(page: Page, name: string, barId: string, height: number) {
  await page.waitForTimeout(300);
  const el = await page.evaluate(() => ({ scroll: document.scrollingElement!.scrollHeight, client: document.scrollingElement!.clientHeight }));
  expect(el.scroll, `${name}：ページの高さ`).toBeLessThanOrEqual(el.client);
  const board = (await page.getByTestId('board').boundingBox())!;
  const bar = (await page.getByTestId(barId).boundingBox())!;
  expect(board.y, `${name}：盤`).toBeGreaterThanOrEqual(0);
  expect(bar.y, `${name}：操作バーは盤の下`).toBeGreaterThan(board.y + board.height - 1);
  expect(bar.y + bar.height, `${name}：操作バーは画面の中`).toBeLessThanOrEqual(height);
  for (const hand of ['hand-white', 'hand-black']) {
    const h = (await page.getByTestId(hand).boundingBox())!;
    expect(h.y + h.height, `${name}：${hand}`).toBeLessThanOrEqual(bar.y + 1);
  }
}

for (const [w, h] of [
  [360, 640],
  [360, 740],
  [390, 844],
  [412, 800],
  [1180, 820],
] as [number, number][]) {
  test(`${w}×${h}：盤の画面（定跡帳・ツリー・新しいツリー・復習）はページ全体がスクロールしない`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    const wide = w > h;
    await setup(page);

    // 定跡帳の盤：研究候補は枠の中。盤の下に［取り消す］［まとめて復習］・メモは出さない（⋯ と ★ の行から）
    await page.goto('./');
    await (await openStudyList(page)).getByTestId('study-item').first().click();
    await page.getByTestId('study-prev').click();
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-book-branch')).toHaveCount(4);
    await expectOneScreen(page, '定跡帳', 'study-nav', h);
    await expect(page.getByTestId('study-screen-note')).toHaveCount(0);
    const rows = page.getByTestId('study-book-branch');
    // 1 行目は見える。いちばん下の行は、枠の中でスクロールすれば見える（盤と操作バーは動かない）
    await expect(rows.first()).toBeInViewport();
    const barBefore = (await page.getByTestId('study-nav').boundingBox())!.y;
    await expect(async () => {
      await rows.last().scrollIntoViewIfNeeded();
      await expect(rows.last()).toBeInViewport({ ratio: 0.99, timeout: 500 });
    }).toPass();
    expect((await page.getByTestId('study-nav').boundingBox())!.y).toBeCloseTo(barBefore, 0);
    // 360×640 以外のスマホ縦では 3 行目まで見える（360×640 は盤を 220px より小さくしないので 2 行。持ち主の判断 2026-11-22）
    if (!wide && h > 640) {
      await rows.first().scrollIntoViewIfNeeded();
      const third = (await rows.nth(2).boundingBox())!;
      expect(third.y + third.height).toBeLessThanOrEqual(h);
    }

    // ツリー：候補手 3 行目まで見え、4 行目は枠の中
    await page.goto('./#/trees');
    await page.getByTestId('tree-item').click();
    await expect(page.getByTestId('candidate')).toHaveCount(4);
    await expectOneScreen(page, 'ツリー', 'tree-nav', h);
    const third = (await page.getByTestId('candidate').nth(2).boundingBox())!;
    expect(third.y + third.height).toBeLessThanOrEqual(h);

    // 新しいツリー：作るボタンは画面の中
    await page.goto('./#/trees');
    await page.getByTestId('new-tree').click();
    await expectOneScreen(page, '新しいツリー', 'input-nav', h);
    await expect(page.getByTestId('start-normal')).toBeInViewport({ ratio: 0.99 });

    // 復習：問題のカード（まちがえた後の［もう一度］［正解を見る］も）が画面の中（段階19 からツリーの復習で。稽古の画面は e2e/phase19.spec.ts）
    await page.goto('./#/review/one-tree');
    await expect(page.getByTestId('review-prompt')).toHaveAttribute('data-phase', 'ask');
    await expectOneScreen(page, '復習', 'review-nav', h);
    await page.locator('[data-square="17"]').click();
    await page.locator('[data-square="16"]').click();
    await expect(page.getByTestId('review-wrong')).toBeVisible();
    await expectOneScreen(page, '復習（まちがえた後）', 'review-nav', h);
    await expect(page.getByTestId('review-retry')).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByTestId('review-show')).toBeInViewport({ ratio: 0.99 });
  });
}
