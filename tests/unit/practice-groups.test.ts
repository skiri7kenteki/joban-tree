// 段階26-1：稽古のタブを定跡帳ごとにまとめる（見出し・手順の近い順・行の文字）
import { describe, expect, it } from 'vitest';
import { forkLabel, groupPractice, practiceBookName, practiceRowLabel } from '../../src/practice/groups';
import { LEARNED_STEP, startOfDay, type PracticeRecord } from '../../src/practice/practice';
import { defaultStudyName } from '../../src/tree/studies';
import { studyGroupKey } from '../../src/tree/organize';
import { BUNDLED_TEMPLATES } from '../../src/tree/templates';
import type { Study } from '../../src/tree/types';

const T = BUNDLED_TEMPLATES;
const NOW = new Date(2026, 10, 27, 10, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
/** 横歩取り・後手番の 16 手目 △3三角まで */
const BASE = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
const COMMON = [...BASE, '5i5h', '5a6b', '3g3f', '7a7b', '2i3g', '6c6d'];

const study = (id: string, moves: string[], updatedAt: number, extra: Partial<Study> = {}): Study => {
  const s: Study = { id, name: '', note: '', moves, mySide: 'white', createdAt: updatedAt, updatedAt, ...extra };
  return { ...s, name: extra.name ?? defaultStudyName(s, T) };
};
const rec = (studyId: string, patch: Partial<PracticeRecord> = {}): PracticeRecord => ({
  studyId,
  step: 0,
  dueAt: startOfDay(NOW) + DAY,
  lastAt: NOW - DAY,
  firstAt: NOW - 10 * DAY,
  lastMistakes: 0,
  count: 1,
  ...patch,
});

// 23 手目で分かれる 2 本と、20 手目で分かれる 1 本（直した日は a がいちばん新しい）
const a = study('a', [...COMMON, '3i4h', '7b6c'], 30);
const b = study('b', [...COMMON, '3i3h', '7b6c'], 20);
const c = study('c', [...BASE, '5i5h', '5a6b', '3g3f', 'P*8b', '3i3h', '7a7b'], 10);
/** 横歩取りではない（その他・先手番） */
const o = study('o', ['7g7f', '3c3d', '6g6f', '8c8d', '2h6h'], 5, { mySide: 'black' });
const KEY = studyGroupKey(a, T);
const OTHER = studyGroupKey(o, T);

describe('行の文字（分かれ目を主に）', () => {
  const pool = [a, b, c];

  it('その定跡帳の中で、その手順だけになる最初の手から、最後の手まで', () => {
    expect(forkLabel(a, pool, T)).toBe('23手目 ▲４八銀 から △６三銀まで');
    expect(forkLabel(b, pool, T)).toBe('23手目 ▲３八銀 から △６三銀まで');
    expect(forkLabel(c, pool, T)).toBe('20手目 △８二歩 から △７二銀まで');
  });

  it('ほかの手順に丸ごと含まれる短い手順は「n手目 X まで」', () => {
    const short = study('s', COMMON.slice(0, 20), 1);
    expect(forkLabel(short, [...pool, short], T)).toBe('20手目 △７二銀 まで');
  });

  it('分かれ目が最後の手なら、手は 1 つだけ', () => {
    const end = study('e', [...COMMON, '9g9f'], 1);
    expect(forkLabel(end, [...pool, end], T)).toBe('23手目 ▲９六歩まで');
  });

  it('定跡帳に 1 本だけなら、稽古を始める手から', () => {
    expect(forkLabel(a, [a], T)).toBe('17手目 ▲５八玉 から △６三銀まで');
  });

  it('「同」は使わず、ます目を書く', () => {
    const take = study('t', [...BASE.slice(0, 10)], 1, { mySide: 'black' });
    expect(forkLabel(take, [take], T)).not.toContain('同');
  });

  it('自分で付けた名前はそのまま。自動の名前なら分かれ目', () => {
    const named = study('n', [...COMMON, '9g9f'], 1, { name: '対 端歩の研究' });
    expect(practiceRowLabel(named, [...pool, named], T)).toBe('対 端歩の研究');
    expect(practiceRowLabel(a, pool, T)).toBe(forkLabel(a, pool, T));
  });
});

describe('定跡帳の名前', () => {
  it('定跡帳の名前と自分の側', () => {
    expect(practiceBookName(KEY)).toBe('横歩取り ☖後手');
    expect(practiceBookName(OTHER)).toBe('その他 ☗先手');
  });
});

describe('定跡帳ごとのまとめ', () => {
  const all = [c, o, b, a];

  it('定跡帳の順は渡した並びで最初に出る順、中は手順の近い順（定跡帳の一覧・KIF と同じ）', () => {
    const items = [o, c, a, b].map((s) => ({ study: s }));
    const groups = groupPractice(items, all, new Map(), T);
    expect(groups.map((g) => g.key)).toEqual([OTHER, KEY]);
    // 手の多く集まる枝（a・b）が先、その中は直した日の新しい順
    expect(groups[1].items.map((i) => i.study.id)).toEqual(['a', 'b', 'c']);
  });

  it('見出しの数は定跡帳の全部から（身についた a／b本・手順の数）。次の稽古の日はその中でいちばん早い日', () => {
    const records = new Map([
      ['a', rec('a', { step: LEARNED_STEP, dueAt: startOfDay(NOW) + 7 * DAY })],
      ['b', rec('b', { dueAt: startOfDay(NOW) + 3 * DAY })],
    ]);
    const [g] = groupPractice([{ study: a, record: records.get('a')! }, { study: b, record: records.get('b')! }], all, records, T);
    expect([g.learned, g.total, g.items.length]).toEqual([1, 3, 2]);
    expect(g.nextDue).toBe(startOfDay(NOW) + 3 * DAY);
  });
});
