// 閲覧画面の候補手リスト用：相手の応手に対する自分の対応、枝の先にどれだけ調べてあるか（段階4）。
// 一覧・復習画面用：開始局面に至るまでの手順。

import { STARTPOS_SFEN, applyUsiMove, moveText } from '../shogi/position';
import { isAfterDubiousOnly } from './generator';
import type { TreeData, TreeEdge, TreeNode } from './types';

/**
 * 自分の対応の手の印（段階4-3 B で「自分の手」「最善」を足した）
 * - chosen：利用者が選んで調べた手（自分の手）
 * - best：エンジンの最善手（同じ局面に「自分の手」があるとき）
 * - verified：エンジンの最善手（検証済み）
 * - before-verify：検証で別の手が最善になった、前の手（検証前の手）
 * - unverified：読み筋から取っただけの手（未検証）
 * - none：印なし（調べていない局面の確定した手。ふつうは無い）
 */
export type MineMark = 'chosen' | 'best' | 'verified' | 'before-verify' | 'unverified' | 'none';

export const MINE_MARK_TEXT: Record<MineMark, string> = {
  chosen: '自分の手',
  best: '最善',
  verified: '検証済み',
  'before-verify': '検証前の手',
  unverified: '未検証',
  none: '',
};

export function mineMark(node: TreeNode, edge: TreeEdge): MineMark {
  if (edge.userChosen) return 'chosen';
  if (edge.unverified) return node.searched ? 'before-verify' : 'unverified';
  if (!node.searched) return 'none';
  return node.edges.some((e) => e.userChosen) ? 'best' : 'verified';
}

/** 詰みが絡んで評価値の差が大きすぎるとき（数字では出さない） */
const HUGE_LOSS = 10_000;

/** 自分の手の、最善手との差の短い文（例：「最善より −80」「最善と同じ」） */
export function lossText(loss: number): string {
  if (loss <= 0) return '最善と同じ';
  if (loss >= HUGE_LOSS) return '最善より大きく悪い（詰みの差）';
  return `最善より −${loss}`;
}

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
 * 手 edge の先に、手が分かっている局面（次の手が入っている局面）がいくつあるか。
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

/** 開始局面に至るまでの手順（棋譜の初めから）を、1 手ずつ日本語にする（例：["▲７六歩", "△３四歩"]） */
export function prefixMoveTexts(tree: Pick<TreeData, 'prefix'>): string[] {
  const texts: string[] = [];
  let sfen = tree.prefix.initialSfen;
  let prev: string | undefined;
  for (const move of tree.prefix.moves) {
    texts.push(moveText(sfen, move, prev));
    const next = applyUsiMove(sfen, move);
    if (!next) break;
    sfen = next.sfen;
    prev = move;
  }
  return texts;
}

/** 一覧に出す「開始局面まで」の短い説明（例：「…▲２六歩 △３四歩」「平手の初期局面」） */
export function prefixSummary(tree: Pick<TreeData, 'prefix'>, count = 3): string {
  const texts = prefixMoveTexts(tree);
  if (texts.length === 0) return tree.prefix.initialSfen === STARTPOS_SFEN ? '平手の初期局面' : '指定の局面';
  const tail = texts.slice(-count).join(' ');
  return texts.length > count ? `…${tail}` : tail;
}

/** 開始局面の直前の手（開始局面に「最終手」の印を付ける用）。手順が無ければ undefined */
export function lastPrefixMove(tree: Pick<TreeData, 'prefix'>): string | undefined {
  return tree.prefix.moves[tree.prefix.moves.length - 1];
}
