// 復習モードのロジック（出題する応手の選び方・記録・まとめ）
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN, applyUsiMove } from '../../src/shogi/position';
import {
  answerOf,
  computeNeeds,
  emptyRecord,
  pickReply,
  recordAnswer,
  summarize,
} from '../../src/review/review';
import type { TreeData, TreeNode } from '../../src/tree/types';
import { cp, keyAfter, newTree } from './mock-engine';

/**
 * 自分は後手。平手から
 *   ▲７六歩 → △３四歩（確定）→ ▲２六歩 → △８四歩（確定）
 *   ▲２六歩 → △８四歩（確定）
 *   ▲５六歩 → （自分の手なし）
 */
function sampleTree(): TreeData {
  const tree = newTree('white', STARTPOS_SFEN);
  const add = (moves: string[], round: number): TreeNode => {
    let sfen = STARTPOS_SFEN;
    for (const m of moves) sfen = applyUsiMove(sfen, m)!.sfen;
    const key = keyAfter(...moves);
    tree.nodes[key] ??= { key, sfen, round, edges: [] };
    return tree.nodes[key];
  };
  const link = (from: string[], move: string, round: number, searched = false) => {
    const a = add(from, round);
    const b = add([...from, move], a.round + (searched || from.length % 2 === 1 ? 1 : 0));
    a.edges.push({ move, to: b.key, score: cp(10) });
    if (searched) a.searched = { movetimeMs: 1, multiPV: 1, depth: 1, nodes: 1 };
  };
  link([], '7g7f', 0);
  link(['7g7f'], '3c3d', 0, true);
  link(['7g7f', '3c3d'], '2g2f', 1);
  link(['7g7f', '3c3d', '2g2f'], '8c8d', 1, true);
  link([], '2g2f', 0);
  link(['2g2f'], '8c8d', 0, true);
  link([], '5g5f', 0);
  return tree;
}

describe('復習モード', () => {
  it('答えは自分の手番の局面の先頭の手。相手の手番や手の無い局面は問題にならない', () => {
    const tree = sampleTree();
    expect(answerOf(tree, keyAfter('7g7f'))?.move).toBe('3c3d');
    expect(answerOf(tree, tree.rootKey)).toBeNull();
    expect(answerOf(tree, keyAfter('5g5f'))).toBeNull();
  });

  it('問題の先が無い応手（▲５六歩）は選ばない。まだ出していない問題の多い枝ほど選ばれやすい', () => {
    const tree = sampleTree();
    const needs = computeNeeds(tree, emptyRecord(tree.id));
    // ▲７六歩の先には問題が 2 つ、▲２六歩の先には 1 つ
    expect(needs.get(keyAfter('7g7f'))).toBe(2);
    expect(needs.get(keyAfter('2g2f'))).toBe(1);
    expect(needs.get(keyAfter('5g5f'))).toBe(0);
    // 乱数 0〜1 を、重み 2:1 で分ける
    expect(pickReply(tree, tree.rootKey, needs, () => 0.5)?.move).toBe('7g7f');
    expect(pickReply(tree, tree.rootKey, needs, () => 0.7)?.move).toBe('2g2f');
    expect(pickReply(tree, tree.rootKey, needs, () => 0.999)?.move).toBe('2g2f');
  });

  it('間違えた問題は出したさが上がり、正解が続くと下がる', () => {
    const tree = sampleTree();
    const k = keyAfter('2g2f');
    let record = recordAnswer(emptyRecord(tree.id), k, false, 1);
    expect(computeNeeds(tree, record).get(k)).toBe(2);
    record = recordAnswer(record, k, true, 2);
    expect(computeNeeds(tree, record).get(k)).toBe(0.25);
    record = recordAnswer(record, k, true, 3);
    expect(computeNeeds(tree, record).get(k)).toBe(0.125);
    expect(record.nodes[k]).toEqual({ seen: 3, correct: 2, streak: 2, lastOk: true, lastAt: 3 });
  });

  it('記録のまとめ：問題の数・まだ・前回まちがい・覚えた', () => {
    const tree = sampleTree();
    let record = emptyRecord(tree.id);
    expect(summarize(tree, record)).toEqual({ total: 3, unseen: 3, wrong: 0, learned: 0 });
    record = recordAnswer(record, keyAfter('7g7f'), false, 1);
    record = recordAnswer(record, keyAfter('2g2f'), true, 1);
    record = recordAnswer(record, keyAfter('2g2f'), true, 2);
    expect(summarize(tree, record)).toEqual({ total: 3, unseen: 1, wrong: 1, learned: 1 });
  });

  it('同じ局面に戻る手順（ループ）があっても止まる', () => {
    const tree = sampleTree();
    const me = tree.nodes[keyAfter('7g7f', '3c3d', '2g2f', '8c8d')];
    // わざと開始局面へ戻る枝を作る
    me.edges.push({ move: '9g9f', to: tree.rootKey, score: cp(0) });
    expect(() => computeNeeds(tree, emptyRecord(tree.id))).not.toThrow();
    expect(summarize(tree, emptyRecord(tree.id)).total).toBe(3);
  });
});
