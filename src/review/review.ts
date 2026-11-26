// 復習モードのロジック（画面から切り離してテストする）。
//
// 出題のしかた（持ち主の判断 2026-11-14）：手順を通して出す。範囲は相手の応手すべて（疑問手の咎め方も覚える）。
//   1. 開始局面から始める。相手の手番なら、アプリが相手の応手を 1 つ選んで指す
//   2. 自分の手番の局面＝問題。ツリーの自分の手（先頭の手）が正解
//   3. 正解なら次へ。手順の終わり（答えの無い局面・応手の無い局面）まで続ける
//   4. 相手の応手は「その先に、まだ出していない問題・間違えた問題が多い枝」ほど選ばれやすい
//   5. 相手が疑問手を指したら、咎める 1 手だけを出して、その手順は終わり（持ち主の判断 2026-11-14：
//      「悪手に対する次の一手を覚えるのは意味があるが、悪手以降の手順を深く掘り下げても意味が薄い」）

import { isOpponentNode } from '../tree/generator';
import { DEFAULT_THRESHOLDS, labelOf, type LabelThresholds } from '../tree/labels';
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

/** 自分の手番の局面の答え（ツリーの先頭の手）。相手の手番・手が無い局面は null */
export function answerOf(tree: TreeData, key: string): TreeEdge | null {
  const node = tree.nodes[key];
  if (!node || isOpponentNode(tree, node)) return null;
  return node.edges[0] ?? null;
}

/** 相手の疑問手か（その後は、咎める 1 手だけを出す） */
export function isDubiousReply(edge: TreeEdge, thresholds: LabelThresholds = DEFAULT_THRESHOLDS): boolean {
  return edge.diff !== undefined && labelOf(edge.diff, thresholds) === 'dubious';
}

/** 相手の応手 1 つぶんの「出したさ」を入れておくキー（computeNeeds の結果の中で、局面のキーと区別する） */
export function replyKey(from: string, move: string): string {
  return `${from}>${move}`;
}

/** 1 つの問題の「出したさ」：まだ出していない 1、前回間違えた 2、正解が続くほど小さく */
export function questionNeed(rec: NodeRecord | undefined): number {
  if (!rec) return 1;
  if (!rec.lastOk) return 2;
  return 0.5 ** (rec.streak + 1);
}

/**
 * 各局面について「その局面から先にある問題の、出したさの合計」を求める。
 * 0 なら、その先に問題が無い。同じ局面への合流は 1 回だけ数え、ループ（同じ局面に戻る手順）は打ち切る。
 * 相手の応手ごとの値も replyKey(局面, 手) に入れる（疑問手なら、咎める 1 問の分だけ）。
 */
export function computeNeeds(tree: TreeData, record: ReviewRecord, thresholds: LabelThresholds = DEFAULT_THRESHOLDS): Map<string, number> {
  const memo = new Map<string, number>();
  /** 疑問手の後の局面：咎める 1 問だけ（その先は出さない） */
  const questionOnly = (key: string): number => {
    const node = tree.nodes[key];
    if (!node || isOpponentNode(tree, node) || !node.edges[0]) return 0;
    return questionNeed(record.nodes[key]);
  };
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
      for (const edge of node.edges) {
        const w = isDubiousReply(edge, thresholds) ? questionOnly(edge.to) : visit(edge.to);
        memo.set(replyKey(key, edge.move), w);
        need += w;
      }
    } else {
      const answer = node.edges[0];
      if (answer) need = questionNeed(record.nodes[key]) + visit(answer.to);
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
  const weight = (e: TreeEdge) => needs.get(replyKey(key, e.move)) ?? 0;
  const candidates = node.edges.filter((e) => weight(e) > 0);
  if (candidates.length === 0) return null;
  const total = candidates.reduce((sum, e) => sum + weight(e), 0);
  let r = rand() * total;
  for (const edge of candidates) {
    r -= weight(edge);
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
  /** 覚えた＝最後に答えたとき 1 回目で正解（lastOk。持ち主の判断 2026-11-21。前は 2 回続けて正解）。
   *  一度すべて正解すれば 100%、あとでまちがえた問題は「前回まちがい」に移る。total＝unseen＋wrong＋learned */
  learned: number;
}

/** 開始局面からたどれる問題の、記録のまとめ（疑問手の後は、咎める 1 問だけ数える） */
export function summarize(tree: TreeData, record: ReviewRecord, thresholds: LabelThresholds = DEFAULT_THRESHOLDS): ReviewSummary {
  const summary: ReviewSummary = { total: 0, unseen: 0, wrong: 0, learned: 0 };
  /** 問題として数えた局面 */
  const counted = new Set<string>();
  /** その先までたどった局面（疑問手の後で数えただけの局面も、ほかの手順から来たときはたどる） */
  const expanded = new Set<string>();
  const stack: { key: string; questionOnly: boolean }[] = [{ key: tree.rootKey, questionOnly: false }];
  while (stack.length > 0) {
    const { key, questionOnly } = stack.pop()!;
    const node = tree.nodes[key];
    if (!node) continue;
    if (isOpponentNode(tree, node)) {
      if (questionOnly || expanded.has(key)) continue;
      expanded.add(key);
      for (const edge of node.edges) stack.push({ key: edge.to, questionOnly: isDubiousReply(edge, thresholds) });
      continue;
    }
    const answer = node.edges[0];
    if (!answer) continue;
    if (!counted.has(key)) {
      counted.add(key);
      summary.total++;
      const rec = record.nodes[key];
      if (!rec) summary.unseen++;
      else if (!rec.lastOk) summary.wrong++;
      else summary.learned++;
    }
    if (questionOnly || expanded.has(key)) continue;
    expanded.add(key);
    stack.push({ key: answer.to, questionOnly: false });
  }
  return summary;
}
