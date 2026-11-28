// 前の版の復習の記録（データの形）と、移し替え（storage/migrate.ts）が使う計算。
// 復習の画面は「機能の整理」で消したが、端末の記録は消さない（バックアップ・Google ドライブの同期は読んだまま持ち運ぶ）。

import { sideToMove } from '../shogi/position';
import type { TreeData, TreeEdge, TreeNode } from '../tree/types';

/** 1 つの問題（自分の手番の局面）の記録 */
export interface NodeRecord {
  /** 出題した回数（同じ回の「もう一度」は数えない） */
  seen: number;
  /** 1 回目で正解した回数 */
  correct: number;
  /** 続けて正解している回数（間違えたら 0） */
  streak: number;
  /** 最後に出したとき正解だったか */
  lastOk: boolean;
  lastAt: number;
}

/** ツリー 1 つぶんの復習の記録 */
export interface ReviewRecord {
  /** 戻すで復活させた日時（段階22-2。消した記録より勝つ） */
  restoredAt?: number;
  treeId: string;
  version: 1;
  /** 局面のキー → 記録 */
  nodes: Record<string, NodeRecord>;
}

export function emptyRecord(treeId: string): ReviewRecord {
  return { treeId, version: 1, nodes: {} };
}

/** その局面が相手の手番か（相手ノードか） */
export function isOpponentNode(tree: TreeData, node: TreeNode): boolean {
  return sideToMove(node.sfen) !== tree.mySide;
}

/** 自分の手番の局面の答え（ツリーの先頭の手）。相手の手番・手が無い局面は null */
export function answerOf(tree: TreeData, key: string): TreeEdge | null {
  const node = tree.nodes[key];
  if (!node || isOpponentNode(tree, node)) return null;
  return node.edges[0] ?? null;
}

/** 局面と手を合わせた記録のキー */
export function replyKey(from: string, move: string): string {
  return `${from}>${move}`;
}
