// 段階19：研究手順の 1 局面ずつの復習（#/study-review）は稽古に置きかえた。
// 復習の画面（1 回 n 問・結果・正解の光など）を確かめるテストは、残っている「ツリーの復習の『研究手順だけ』」（#/review/<id>/study）から開く。
// 平手の初期局面から始まるツリーなら、研究手順を初手から出題する（前の 1 本だけの復習と同じ問題になる）
import { expect, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type TreeData, type TreeNode } from '../src/tree/types';

/** 平手の初期局面から ▲7六歩 の 1 手だけのツリー（自分は先手） */
export function startTree(id = 'start-tree', mySide: 'black' | 'white' = 'black'): TreeData {
  const root: TreeNode = { key: sfenKey(STARTPOS_SFEN), sfen: STARTPOS_SFEN, round: 0, edges: [] } as TreeNode;
  const sfen = applyUsiMove(STARTPOS_SFEN, '7g7f')!.sfen;
  const next: TreeNode = { key: sfenKey(sfen), sfen, round: 0, edges: [] } as TreeNode;
  root.edges.push({ move: '7g7f', to: next.key, score: { kind: 'cp', value: 30 }, diff: 0 } as never);
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id,
    name: '初期局面からのツリー',
    createdAt: 1,
    updatedAt: 1,
    mySide,
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: [] },
    nodes: { [root.key]: root, [next.key]: next },
    settings: { totalMs: 1000, movetimeMs: 100, multiPV: 1, maxRounds: 1, maxNodes: 10, windowCp: 300 },
  } as TreeData;
}

/** 研究手順を取り込んだ後に呼ぶ：初期局面からのツリーを取り込み、その「研究手順だけ」の復習を開く */
export async function openStudyReview(page: Page, mySide: 'black' | 'white' = 'black'): Promise<void> {
  const tree = startTree(`start-${mySide}`, mySide);
  await page.goto('./#/trees');
  await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tree)) });
  await expect(page.getByTestId('tree-item').filter({ hasText: tree.name })).toHaveCount(1);
  await page.goto(`./#/review/${tree.id}/study`);
  await expect(page.getByTestId('review-prompt')).toBeVisible();
}
