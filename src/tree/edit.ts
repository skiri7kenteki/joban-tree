// 自分の対応の手を、利用者が手で並べ替える・消す（段階4-3 B）。
// - 本線にする：その手をいちばん上に（復習の正解・書き出しの本譜・「ここから展開」でたどる手になる）
// - 消す：その手と、どこからもたどれなくなった先の局面を消す（元に戻せないので、画面で確認してから）

import type { TreeData, TreeNode } from './types';

/** 手 move を、その局面の本線（いちばん上）にする。もう本線か、その手が無ければ false */
export function makeMainMove(node: TreeNode, move: string): boolean {
  const index = node.edges.findIndex((e) => e.move === move);
  if (index <= 0) return false;
  const [edge] = node.edges.splice(index, 1);
  node.edges.unshift(edge);
  return true;
}

/** 開始局面からたどれる局面のキー（除外した手の先も、戻せるように残すので含める）。skip の手は通らない */
function reachableKeys(tree: TreeData, skip?: { from: string; move: string }): Set<string> {
  const seen = new Set<string>();
  const stack = [tree.rootKey];
  while (stack.length > 0) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = tree.nodes[key];
    if (!node) continue;
    for (const edge of [...node.edges, ...(node.excluded ?? [])]) {
      if (skip && key === skip.from && edge.move === skip.move) continue;
      stack.push(edge.to);
    }
  }
  return seen;
}

/**
 * 局面 key の手 move を消したら、いっしょに消える局面のうち、次の手が分かっている局面の数（確認の文に出す）。
 * 候補手の行の「先に N 局面」と同じ数え方（手の無い末端の局面は数えない）
 */
export function countRemoved(tree: TreeData, key: string, move: string): number {
  const reachable = reachableKeys(tree, { from: key, move });
  return Object.values(tree.nodes).filter((n) => !reachable.has(n.key) && n.edges.length > 0).length;
}

/**
 * 局面 key の手 move を消す。どこからもたどれなくなった先の局面も消す（ほかの手順から来られる局面は残す）。
 * その局面の最後の 1 手は消さない（調べた記録だけ残って、手の無い局面になってしまうため）。消せたら true
 */
export function deleteMove(tree: TreeData, key: string, move: string): boolean {
  const node = tree.nodes[key];
  if (!node || node.edges.length <= 1 || !node.edges.some((e) => e.move === move)) return false;
  node.edges = node.edges.filter((e) => e.move !== move);
  const reachable = reachableKeys(tree);
  for (const k of Object.keys(tree.nodes)) if (!reachable.has(k)) delete tree.nodes[k];
  return true;
}
