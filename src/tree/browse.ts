// 閲覧画面の候補手リスト用：相手の応手に対する自分の対応、枝の先にどれだけ調べてあるか（段階4）。

import { isAfterDubiousOnly } from './generator';
import type { TreeData, TreeEdge } from './types';

/** 相手の応手の後の、自分の対応（その局面のいちばん上の手）。まだ無ければ undefined */
export function replyOf(tree: TreeData, edge: TreeEdge): TreeEdge | undefined {
  return tree.nodes[edge.to]?.edges[0];
}

/** 枝の先の様子 */
export type BranchInfo =
  | { kind: 'unexpanded' } // まだ何も調べていない
  | { kind: 'terminal' } // 指せる手が無い（詰み・投了など）
  | { kind: 'answer-only' } // 相手の疑問手：咎める手までで止めてある（v0.6.2〜）
  | { kind: 'reply-only' } // 相手の応手：自分の対応までは分かっているが、その先はまだ
  | { kind: 'count'; positions: number }; // 先に何局面あるか

/**
 * 手 edge の先に、手が分かっている局面（矢印が出ている局面）がいくつあるか。
 * 合流した局面は 1 回だけ数える（その枝の中で重複を除く）。edge の行き先の局面も数に入れる
 */
export function countAhead(tree: TreeData, edge: TreeEdge): number {
  const seen = new Set<string>();
  const stack = [edge.to];
  let count = 0;
  while (stack.length > 0) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = tree.nodes[key];
    if (!node || node.edges.length === 0) continue;
    count++;
    for (const e of node.edges) stack.push(e.to);
  }
  return count;
}

/** 候補手 edge の先の様子（行の右下に小さく出す） */
export function branchInfo(tree: TreeData, edge: TreeEdge): BranchInfo {
  const next = tree.nodes[edge.to];
  if (!next) return { kind: 'unexpanded' };
  if (next.terminal) return { kind: 'terminal' };
  if (next.edges.length === 0) return { kind: 'unexpanded' };
  // 相手の応手で、自分の対応の先をまだ調べていない
  if (edge.diff !== undefined && next.edges.every((e) => (tree.nodes[e.to]?.edges.length ?? 0) === 0)) {
    // 疑問手の先は浅くする設定のために、咎める手の後を調べていない
    const answer = tree.nodes[next.edges[0].to];
    if (answer && !answer.terminal && isAfterDubiousOnly(tree, answer.key)) return { kind: 'answer-only' };
    return { kind: 'reply-only' };
  }
  return { kind: 'count', positions: countAhead(tree, edge) };
}

/** 枝の先の様子を短い文に（例：「先に 12 局面」「未展開」「咎めまで」） */
export function branchText(info: BranchInfo): string {
  switch (info.kind) {
    case 'unexpanded':
      return '未展開';
    case 'terminal':
      return '終局';
    case 'answer-only':
      return '咎めまで';
    case 'reply-only':
      return '対応まで';
    case 'count':
      return `先に ${info.positions} 局面`;
  }
}
