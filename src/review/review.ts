// 復習モードのロジック（画面から切り離してテストする）。
//
// 出題のしかた（持ち主の判断 2026-11-14）：手順を通して出す。範囲は相手の応手すべて（疑問手の咎め方も覚える）。
//   1. 開始局面から始める。相手の手番なら、アプリが相手の応手を 1 つ選んで指す
//   2. 自分の手番の局面＝問題。ツリーの自分の手（先頭の手）が正解
//   3. 正解なら次へ。手順の終わり（答えの無い局面・応手の無い局面）まで続ける
//   4. 相手の応手は「その先に、まだ出していない問題・間違えた問題が多い枝」ほど選ばれやすい

import { isOpponentNode } from '../tree/generator';
import type { TreeData, TreeEdge } from '../tree/types';

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
  treeId: string;
  version: 1;
  /** 局面のキー → 記録 */
  nodes: Record<string, NodeRecord>;
}

export function emptyRecord(treeId: string): ReviewRecord {
  return { treeId, version: 1, nodes: {} };
}

/** 自分の手番の局面の答え（ツリーの先頭の手）。相手の手番・手が無い局面は null */
export function answerOf(tree: TreeData, key: string): TreeEdge | null {
  const node = tree.nodes[key];
  if (!node || isOpponentNode(tree, node)) return null;
  return node.edges[0] ?? null;
}

/** 「覚えた」とみなす連続正解の回数 */
export const LEARNED_STREAK = 2;

/** 1 つの問題の「出したさ」：まだ出していない 1、前回間違えた 2、正解が続くほど小さく */
function ownNeed(rec: NodeRecord | undefined): number {
  if (!rec) return 1;
  if (!rec.lastOk) return 2;
  return 0.5 ** (rec.streak + 1);
}

/**
 * 各局面について「その局面から先にある問題の、出したさの合計」を求める。
 * 0 なら、その先に問題が無い。同じ局面への合流は 1 回だけ数え、ループ（同じ局面に戻る手順）は打ち切る。
 */
export function computeNeeds(tree: TreeData, record: ReviewRecord): Map<string, number> {
  const memo = new Map<string, number>();
  const visiting = new Set<string>();
  const visit = (key: string): number => {
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    if (visiting.has(key)) return 0;
    const node = tree.nodes[key];
    if (!node) return 0;
    visiting.add(key);
    let need = 0;
    if (isOpponentNode(tree, node)) {
      for (const edge of node.edges) need += visit(edge.to);
    } else {
      const answer = node.edges[0];
      if (answer) need = ownNeed(record.nodes[key]) + visit(answer.to);
    }
    visiting.delete(key);
    memo.set(key, need);
    return need;
  };
  visit(tree.rootKey);
  return memo;
}

/** 相手の応手を 1 つ選ぶ（その先に問題がある枝だけ。出したさに比例した確率で）。無ければ null */
export function pickReply(
  tree: TreeData,
  key: string,
  needs: Map<string, number>,
  rand: () => number = Math.random,
): TreeEdge | null {
  const node = tree.nodes[key];
  if (!node || !isOpponentNode(tree, node)) return null;
  const candidates = node.edges.filter((e) => (needs.get(e.to) ?? 0) > 0);
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, e) => sum + needs.get(e.to)!, 0);
  let r = rand() * total;
  for (const edge of candidates) {
    r -= needs.get(edge.to)!;
    if (r < 0) return edge;
  }
  return candidates[candidates.length - 1];
}

/** 答えを記録する（元の記録は変えずに、新しい記録を返す） */
export function recordAnswer(record: ReviewRecord, key: string, ok: boolean, now: number): ReviewRecord {
  const prev = record.nodes[key] ?? { seen: 0, correct: 0, streak: 0, lastOk: false, lastAt: 0 };
  const next: NodeRecord = {
    seen: prev.seen + 1,
    correct: prev.correct + (ok ? 1 : 0),
    streak: ok ? prev.streak + 1 : 0,
    lastOk: ok,
    lastAt: now,
  };
  return { ...record, nodes: { ...record.nodes, [key]: next } };
}

export interface ReviewSummary {
  /** 問題（答えのある自分の手番の局面）の数 */
  total: number;
  /** まだ出していない */
  unseen: number;
  /** 前回間違えた */
  wrong: number;
  /** 続けて正解している（LEARNED_STREAK 回以上） */
  learned: number;
}

/** 開始局面からたどれる問題の、記録のまとめ */
export function summarize(tree: TreeData, record: ReviewRecord): ReviewSummary {
  const summary: ReviewSummary = { total: 0, unseen: 0, wrong: 0, learned: 0 };
  const seen = new Set<string>();
  const stack = [tree.rootKey];
  while (stack.length > 0) {
    const key = stack.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = tree.nodes[key];
    if (!node) continue;
    if (isOpponentNode(tree, node)) {
      for (const edge of node.edges) stack.push(edge.to);
      continue;
    }
    const answer = node.edges[0];
    if (!answer) continue;
    summary.total++;
    const rec = record.nodes[key];
    if (!rec) summary.unseen++;
    else if (!rec.lastOk) summary.wrong++;
    else if (rec.streak >= LEARNED_STREAK) summary.learned++;
    stack.push(answer.to);
  }
  return summary;
}
