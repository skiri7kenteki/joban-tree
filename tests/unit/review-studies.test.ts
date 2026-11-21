// 研究手順だけの復習（段階8-1〜 ツリーを使わない）：問題の範囲・出題の始まり・記録のキー・選び方・まとめ・ツリーを通る研究手順・記録の移し替え
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../../src/shogi/position';
import { TreeGenerator, createTree } from '../../src/tree/generator';
import { emptyRecord, recordAnswer, replyKey } from '../../src/review/review';
import {
  STUDY_RECORD_ID,
  liftReviewRecords,
  pickStudy,
  reviewStart,
  studiesThroughTree,
  studyNeed,
  studyPositions,
  studyQuestions,
  studyRecordKey,
  summarizeStudies,
} from '../../src/review/studyReview';
import { traceStudy } from '../../src/tree/studies';
import type { Study, TreeData } from '../../src/tree/types';
import { MockEngine, SETTINGS, newTree } from './mock-engine';

const study = (id: string, moves: string[], mySide: Study['mySide'] = 'white', note = ''): Study => ({
  id,
  name: id,
  note,
  moves,
  mySide,
  createdAt: 1,
  updatedAt: 1,
});

const LINE = ['7g7f', '3c3d', '2g2f', '8c8d', '2f2e', '8d8e'];
const keyAfter = (moves: string[]) => sfenKey(studyPositions(moves)[moves.length]);

describe('研究手順の問題', () => {
  it('問題は自分の手番の局面だけ（相手の手はアプリが指す）。正解は研究手順の手。start 手目より前は出さない', () => {
    const s = study('a', LINE);
    expect(studyQuestions(s, 0).map((q) => [q.index, q.move])).toEqual([
      [1, '3c3d'],
      [3, '8c8d'],
      [5, '8d8e'],
    ]);
    expect(studyQuestions(s, 2).map((q) => q.index)).toEqual([3, 5]);
    expect(studyQuestions(study('b', LINE, 'black'), 0).map((q) => q.index)).toEqual([0, 2, 4]);
    // 相手の手で終わる研究手順でも、最後の自分の手までは出す
    expect(studyQuestions(study('c', LINE.slice(0, 5)), 0).map((q) => q.index)).toEqual([1, 3]);
  });

  it('出題の始まり：戦型の出発点の後に自分の手番が無ければ、初期局面から', () => {
    const s = study('a', LINE.slice(0, 4));
    expect(reviewStart(s, 2)).toBe(2);
    expect(reviewStart(s, 4)).toBe(0);
    expect(reviewStart(study('b', LINE.slice(0, 3)), 2)).toBe(0);
  });

  it('記録のキーは「局面のキー>正解の手」。同じ局面・同じ正解なら研究手順どうしで共有（1 問と数える）', () => {
    const a = study('a', LINE);
    const b = study('b', LINE.slice(0, 4));
    const qa = studyQuestions(a, 0);
    expect(qa[0].recordKey).toBe(studyRecordKey(sfenKey(applyUsiMove(STARTPOS_SFEN, '7g7f')!.sfen), '3c3d'));
    expect(qa[0].recordKey).toBe(replyKey(keyAfter(['7g7f']), '3c3d'));
    expect(studyQuestions(b, 0).map((q) => q.recordKey)).toEqual(qa.slice(0, 2).map((q) => q.recordKey));
    let record = recordAnswer(emptyRecord(STUDY_RECORD_ID), qa[0].recordKey, false, 1);
    record = recordAnswer(record, qa[1].recordKey, true, 2);
    // 覚えた＝最後に答えたとき正解（v0.36.0〜）：1 回の正解で数える
    expect(summarizeStudies([a, b], () => 0, record)).toEqual({ total: 3, unseen: 1, wrong: 1, learned: 1 });
    record = recordAnswer(record, qa[1].recordKey, true, 3);
    expect(summarizeStudies([a, b], () => 0, record)).toEqual({ total: 3, unseen: 1, wrong: 1, learned: 1 });
    // すべて正解すれば 100%
    record = recordAnswer(record, qa[0].recordKey, true, 4);
    record = recordAnswer(record, qa[2].recordKey, true, 5);
    expect(summarizeStudies([a, b], () => 0, record)).toEqual({ total: 3, unseen: 0, wrong: 0, learned: 3 });
  });

  it('同じ局面でも正解の手が違えば別の問題', () => {
    const a = study('a', ['7g7f', '3c3d']);
    const b = study('b', ['7g7f', '8c8d']);
    expect(summarizeStudies([a, b], () => 0, emptyRecord(STUDY_RECORD_ID)).total).toBe(2);
  });

  it('出したさに比例して 1 本選ぶ。問題の無い研究手順は選ばない。覚えると出にくくなる', () => {
    const a = study('a', LINE.slice(0, 4));
    const b = study('b', ['2g2f', '8c8d', '7g7f', '3c3d']);
    const none = study('none', ['7g7f']);
    const empty = emptyRecord(STUDY_RECORD_ID);
    expect(studyNeed(none, 0, empty)).toBe(0);
    expect(pickStudy([none], () => 0, empty)).toBeNull();
    expect(studyNeed(a, 0, empty)).toBe(2);
    expect(pickStudy([a, b, none], () => 0, empty, () => 0.1)?.id).toBe('a');
    expect(pickStudy([a, b, none], () => 0, empty, () => 0.9)?.id).toBe('b');
    let record = empty;
    for (const q of studyQuestions(a, 0)) {
      record = recordAnswer(record, q.recordKey, true, 1);
      record = recordAnswer(record, q.recordKey, true, 2);
    }
    expect(studyNeed(a, 0, record)).toBeCloseTo(0.25);
    expect(pickStudy([a, b], () => 0, record, () => 0.2)?.id).toBe('b');
  });

  it('ツリーの復習画面の「研究手順だけ」：ツリーの開始局面を通り、その先に自分の手番がある研究手順', () => {
    const tree = createTree({
      id: 't',
      name: 't',
      rootSfen: studyPositions(['7g7f', '3c3d'])[2],
      mySide: 'white',
      prefix: { initialSfen: STARTPOS_SFEN, moves: ['7g7f', '3c3d'] },
      settings: SETTINGS,
      now: 0,
    });
    const through = study('through', LINE.slice(0, 4));
    const before = study('before', ['7g7f', '3c3d']);
    const other = study('other', ['2g2f', '8c8d', '7g7f', '3c3d']);
    const oppOnly = study('opp', ['7g7f', '3c3d', '2g2f']);
    expect(studiesThroughTree(tree, [through, before, other, oppOnly]).map((s) => s.id)).toEqual(['through']);
    const sfenTree = { ...tree, prefix: { initialSfen: tree.nodes[tree.rootKey].sfen, moves: [] } };
    expect(studiesThroughTree(sfenTree, [through])).toEqual([]);
  });
});

describe('記録の移し替え（v0.17.0 でツリーの中の研究手順を答えた記録）', () => {
  it('局面のキー（本線と同じ正解）と「局面のキー>手」（本線と違う正解）の記録を、「局面のキー>手」に写す。新しい方を使う', async () => {
    const tree: TreeData = newTree('white');
    await new TreeGenerator(new MockEngine(), tree, { ...SETTINGS, maxRounds: 3 }).run();
    const root = tree.nodes[tree.rootKey];
    const a = root.edges[0];
    const mine = tree.nodes[a.to];
    const main = mine.edges[0];
    const moves = [a.move, main.move];
    tree.studies = [{ id: 's-1', name: 'x', note: '', moves, createdAt: 1, updatedAt: 1 }];
    const keys = traceStudy(tree, moves).keys;
    const rec = { seen: 3, correct: 2, streak: 2, lastOk: true, lastAt: 50 };
    const old = { treeId: tree.id, version: 1 as const, nodes: { [keys[1]]: rec } };
    const lifted = liftReviewRecords([tree], [old]);
    expect(lifted.treeId).toBe(STUDY_RECORD_ID);
    expect(lifted.nodes).toEqual({ [replyKey(keys[1], main.move)]: rec });
    // 新しい記録のキーは、ツリーを使わない復習の問題のキーと同じ
    expect(studyQuestions({ moves, mySide: 'white' }, 0)[0].recordKey).toBe(replyKey(keys[1], main.move));
    // すでにある記録の方が新しければ、そちらを残す
    const newer = { ...rec, lastAt: 99, streak: 0, lastOk: false };
    const base = { treeId: STUDY_RECORD_ID, version: 1 as const, nodes: { [replyKey(keys[1], main.move)]: newer } };
    expect(liftReviewRecords([tree], [old], base).nodes[replyKey(keys[1], main.move)]).toEqual(newer);
    // 記録の無いツリーは何もしない
    expect(liftReviewRecords([tree], []).nodes).toEqual({});
  });
});
