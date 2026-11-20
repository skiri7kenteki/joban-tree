// 段階11-1：復習のタブのまとめ（前回まちがえた問題の数・最後に復習した日）
import { describe, expect, it } from 'vitest';
import { overviewText, recordOverview, studyRecordKeys } from '../../src/review/overview';
import { studyQuestions } from '../../src/review/studyReview';
import type { NodeRecord, ReviewRecord } from '../../src/review/review';

const rec = (lastOk: boolean, lastAt: number): NodeRecord => ({ seen: 1, correct: lastOk ? 1 : 0, streak: lastOk ? 1 : 0, lastOk, lastAt });
const record = (nodes: Record<string, NodeRecord>): ReviewRecord => ({ treeId: 't', version: 1, nodes });

const LINE = ['7g7f', '3c3d', '2g2f', '8c8d', '2f2e', '8d8e'];

describe('復習のタブのまとめ', () => {
  it('記録が無ければ「まだ復習していません」', () => {
    expect(recordOverview(undefined)).toEqual({ wrong: 0, lastAt: null });
    expect(overviewText(recordOverview(record({})))).toBe('まだ復習していません');
  });

  it('全部の問題：前回まちがえた数と、いちばん新しい答えた時刻', () => {
    const r = record({ a: rec(false, 100), b: rec(true, 300), c: rec(false, 200) });
    expect(recordOverview(r)).toEqual({ wrong: 2, lastAt: 300 });
  });

  it('キーを渡せば、その問題だけ（同じキーは 1 回、記録の無いキーは数えない）', () => {
    const r = record({ a: rec(false, 100), b: rec(true, 300), c: rec(false, 200) });
    expect(recordOverview(r, ['a', 'a', 'b', 'x'])).toEqual({ wrong: 1, lastAt: 300 });
    expect(recordOverview(r, ['x'])).toEqual({ wrong: 0, lastAt: null });
  });

  it('研究手順の問題のキー：出題を始める手から、自分の手番。同じ局面・同じ正解は 1 つ', () => {
    const s1 = { moves: LINE, mySide: 'black' as const };
    const s2 = { moves: LINE.slice(0, 4), mySide: 'black' as const };
    const keys = studyRecordKeys([s1, s2], () => 2);
    expect(keys).toEqual(studyQuestions(s1, 2).map((q) => q.recordKey));
    expect(keys).toHaveLength(2);
  });

  it('1 行の文：今日・昨日・日付。まちがいが無ければ「前回まちがえた問題なし」', () => {
    const now = new Date(2026, 10, 20, 15, 0).getTime();
    expect(overviewText({ wrong: 3, lastAt: new Date(2026, 10, 20, 9, 0).getTime() }, now)).toBe('前回まちがえた 3 問・最後に復習 今日');
    expect(overviewText({ wrong: 0, lastAt: new Date(2026, 10, 19, 23, 0).getTime() }, now)).toBe('前回まちがえた問題なし・最後に復習 昨日');
    expect(overviewText({ wrong: 1, lastAt: new Date(2026, 10, 2).getTime() }, now)).toBe('前回まちがえた 1 問・最後に復習 11/2');
    expect(overviewText({ wrong: 1, lastAt: new Date(2025, 0, 5).getTime() }, now)).toBe('前回まちがえた 1 問・最後に復習 2025/1/5');
  });
});
