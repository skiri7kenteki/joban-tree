// 研究手順だけを復習する（2026-11-17）：問題の範囲・正解・記録のキー・研究手順の選び方・まとめ・たどれないとき
import { describe, expect, it } from 'vitest';
import { applyUsiMove, sfenKey } from '../../src/shogi/position';
import { excludeMove, TreeGenerator } from '../../src/tree/generator';
import {
  emptyRecord,
  pickStudy,
  recordAnswer,
  studyNeed,
  studyQuestions,
  studyRecordKey,
  summarize,
  summarizeStudies,
} from '../../src/review/review';
import { traceStudy } from '../../src/tree/studies';
import type { Study, TreeData } from '../../src/tree/types';
import { MockEngine, SETTINGS, newTree } from './mock-engine';

async function built(): Promise<TreeData> {
  const tree = newTree('white');
  await new TreeGenerator(new MockEngine(), tree, { ...SETTINGS, maxRounds: 3 }).run();
  return tree;
}

/** ツリーにある 5 手の手順（相手・自分・相手・自分・相手） */
function line(tree: TreeData, pick: number[] = [0, 0, 1, 0, 0]): string[] {
  const moves: string[] = [];
  let key = tree.rootKey;
  for (const i of pick) {
    const e = tree.nodes[key].edges[i] ?? tree.nodes[key].edges[0];
    moves.push(e.move);
    key = e.to;
  }
  return moves;
}

const study = (id: string, moves: string[], note = ''): Study => ({ id, name: id, note, moves, createdAt: 1, updatedAt: 1 });

describe('研究手順の問題', () => {
  it('問題は研究手順の上の自分の手番の局面だけ（開始局面から研究の終わりまで）。正解は研究手順の手', async () => {
    const tree = await built();
    const moves = line(tree);
    const qs = studyQuestions(tree, study('a', moves));
    // 自分は後手：1・3 手目（0 始まりで 1・3）が自分の手
    expect(qs.map((q) => q.index)).toEqual([1, 3]);
    expect(qs.map((q) => q.move)).toEqual([moves[1], moves[3]]);
    const keys = traceStudy(tree, moves).keys;
    expect(qs.map((q) => q.key)).toEqual([keys[1], keys[3]]);
    // 自分の手で終わる研究手順でも同じ
    expect(studyQuestions(tree, study('b', moves.slice(0, 4))).map((q) => q.index)).toEqual([1, 3]);
    // 相手の手 1 つだけなら問題なし
    expect(studyQuestions(tree, study('c', moves.slice(0, 1)))).toEqual([]);
  });

  it('疑問手の後も最後まで出す（今の復習の「咎める 1 手で終わり」は当てはめない）', async () => {
    const tree = await built();
    const moves = line(tree);
    // 3 手目（相手の応手）を疑問手にする
    const keys = traceStudy(tree, moves).keys;
    tree.nodes[keys[2]].edges.find((e) => e.move === moves[2])!.diff = 500;
    expect(studyQuestions(tree, study('a', moves)).map((q) => q.index)).toEqual([1, 3]);
  });

  it('記録のキー：正解がツリーの本線なら局面のキー（今の復習と共有）、違えば「局面>手」', async () => {
    const tree = await built();
    const moves = line(tree);
    const keys = traceStudy(tree, moves).keys;
    const mine = tree.nodes[keys[1]];
    expect(studyRecordKey(tree, keys[1], mine.edges[0].move)).toBe(keys[1]);
    // 本線でない自分の手を足して、その手を通る研究手順にする
    const other = ['1c1d', '9c9d', '7c7d'].find((m) => applyUsiMove(mine.sfen, m) && !mine.edges.some((e) => e.move === m))!;
    const to = sfenKey(applyUsiMove(mine.sfen, other)!.sfen);
    tree.nodes[to] = { key: to, sfen: applyUsiMove(mine.sfen, other)!.sfen, round: 1, edges: [] };
    mine.edges.push({ move: other, to, score: { kind: 'cp', value: -50 } });
    expect(studyRecordKey(tree, keys[1], other)).toBe(`${keys[1]}>${other}`);
    const qs = studyQuestions(tree, study('x', [moves[0], other]));
    expect(qs).toEqual([{ key: keys[1], index: 1, move: other, recordKey: `${keys[1]}>${other}` }]);
  });

  it('記録は今の復習と共通：研究手順で正解すると、全部の復習でも「覚えた」に近づく。別のキーの記録は全部の復習に影響しない', async () => {
    const tree = await built();
    const moves = line(tree);
    const s = study('a', moves);
    let record = emptyRecord(tree.id);
    for (const q of studyQuestions(tree, s)) {
      record = recordAnswer(record, q.recordKey, true, 1);
      record = recordAnswer(record, q.recordKey, true, 2);
    }
    expect(summarizeStudies(tree, [s], record)).toEqual({ total: 2, unseen: 0, wrong: 0, learned: 2 });
    const all = summarize(tree, record);
    expect(all.learned).toBe(2);
    // 本線と違うキーの記録は、全部の復習のまとめに出ない
    const before = summarize(tree, emptyRecord(tree.id));
    expect(summarize(tree, recordAnswer(emptyRecord(tree.id), `${tree.rootKey}>zz`, false, 1))).toEqual(before);
  });

  it('途中までしかたどれない研究手順は、たどれるところまで', async () => {
    const tree = await built();
    const moves = line(tree);
    const keys = traceStudy(tree, moves).keys;
    excludeMove(tree.nodes[keys[2]], moves[2]);
    expect(studyQuestions(tree, study('a', moves)).map((q) => q.index)).toEqual([1]);
  });
});

describe('研究手順の選び方とまとめ', () => {
  it('出したさに比例して 1 本選ぶ。問題の無い研究手順は選ばない。全部覚えると出にくくなる', async () => {
    const tree = await built();
    const a = study('a', line(tree));
    const b = study('b', line(tree, [1, 0, 0, 0, 0]));
    const none = study('none', line(tree).slice(0, 1));
    const empty = emptyRecord(tree.id);
    expect(studyNeed(tree, none, empty)).toBe(0);
    expect(pickStudy(tree, [none], empty)).toBeNull();
    expect(pickStudy(tree, [], empty)).toBeNull();
    // まだ出していない問題が 2 つずつ → 半々
    expect(studyNeed(tree, a, empty)).toBe(2);
    expect(pickStudy(tree, [a, b, none], empty, () => 0.1)?.id).toBe('a');
    expect(pickStudy(tree, [a, b, none], empty, () => 0.9)?.id).toBe('b');
    // a を覚えたら（2 回続けて正解）、ほとんど b
    let record = empty;
    for (const q of studyQuestions(tree, a)) {
      record = recordAnswer(record, q.recordKey, true, 1);
      record = recordAnswer(record, q.recordKey, true, 2);
    }
    expect(studyNeed(tree, a, record)).toBeCloseTo(0.25);
    expect(pickStudy(tree, [a, b], record, () => 0.2)?.id).toBe('b');
  });

  it('まとめ：同じ局面・同じ正解は 1 問と数える（研究手順どうしで重なる部分）。まちがい・まだ', async () => {
    const tree = await built();
    const moves = line(tree);
    const long = study('long', moves);
    const short = study('short', moves.slice(0, 2));
    const q = studyQuestions(tree, long);
    const record = recordAnswer(emptyRecord(tree.id), q[0].recordKey, false, 1);
    expect(summarizeStudies(tree, [long, short], record)).toEqual({ total: 2, unseen: 1, wrong: 1, learned: 0 });
  });
});
