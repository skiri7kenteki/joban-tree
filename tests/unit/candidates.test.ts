// 段階21-1：自分の手の候補表（本命・次善・悪手）の計算
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN } from '../../src/shogi/position';
import {
  CANDIDATE_MAX,
  candidatesKifLine,
  candidatesProblem,
  chooseMain,
  isUsiMove,
  markText,
  mergeResults,
  setMark,
  setReason,
  sortCandidates,
  tableOf,
  type Candidate,
  type ExamResult,
} from '../../src/tree/candidates';

const cp = (value: number) => ({ kind: 'cp' as const, value });
const res = (move: string, value: number, inBook = false, pv: string[] = ['3c3d']): ExamResult => ({ move, score: cp(value), inBook, pv });
const by = { engine: 'テスト', ms: 3000, at: 100 };
const marks = (t: readonly Candidate[]) => t.map((c) => [c.move, c.mark]);
const used = (move: string, updatedAt: number) => ({ move, studies: [{ updatedAt }] });

describe('自動の印', () => {
  it('研究の手のうち最善に近いものが本命。差が境目の中は次善、超えたら悪手', () => {
    // エンジンの最善 7g7f（研究なし）、研究の手は 2g2f
    const r = mergeResults([], [res('7g7f', 100), res('2g2f', 80, true), res('5g5f', -70), res('9g9f', -71)], { goodMax: 150, by });
    // 基準は本命（80）。7g7f は +20 で次善、5g5f は −150 で次善、9g9f は −151 で悪手
    expect(marks(r.table)).toEqual([
      ['2g2f', 'main'],
      ['7g7f', 'alt'],
      ['5g5f', 'alt'],
      ['9g9f', 'bad'],
    ]);
    expect(r.dropped).toBe(0);
  });

  it('研究の手は、悪くても自動では次善まで', () => {
    const r = mergeResults([], [res('2g2f', 100, true), res('9g9f', -500, true)], { goodMax: 150, by });
    expect(marks(r.table)).toEqual([
      ['2g2f', 'main'],
      ['9g9f', 'alt'],
    ]);
  });

  it('研究の手が無い局面では、エンジンの最善が本命', () => {
    const r = mergeResults([], [res('7g7f', 50), res('2g2f', 40)], { goodMax: 150, by });
    expect(marks(r.table)).toEqual([
      ['7g7f', 'main'],
      ['2g2f', 'alt'],
    ]);
  });

  it('評価値・調べた条件・読み筋（10 手まで。指し手でないものの手前まで）を残す', () => {
    const long = Array.from({ length: 12 }, () => '3c3d');
    const r = mergeResults([], [res('7g7f', 50, false, long), res('2g2f', 40, false, ['8c8d', 'resign', '3c3d'])], { goodMax: 150, by });
    expect(r.table[0]).toMatchObject({ eval: cp(50), by });
    expect(r.table[0].pv).toHaveLength(10);
    expect(r.table[1].pv).toEqual(['8c8d']);
  });
});

describe('もう一度残す', () => {
  const old: Candidate[] = [
    { move: '2g2f', mark: 'main', eval: cp(80), by },
    { move: '7g7f', mark: 'bad', eval: cp(-200), by, reason: '手で付けた' },
    { move: '1g1f', mark: 'alt' },
  ];

  it('手・印・理由は残し、点と読み筋を新しくする。自動の印は新しい手にだけ', () => {
    const later = { engine: 'テスト', ms: 10000, at: 200 };
    const r = mergeResults(old, [res('7g7f', 90, true, ['8c8d']), res('2g2f', 60, true), res('5g5f', -200)], { goodMax: 150, by: later });
    expect(marks(r.table)).toEqual([
      ['2g2f', 'main'],
      ['1g1f', 'alt'],
      ['7g7f', 'bad'],
      ['5g5f', 'bad'],
    ]);
    expect(r.table.find((c) => c.move === '7g7f')).toMatchObject({ eval: cp(90), by: later, pv: ['8c8d'], reason: '手で付けた' });
    // 今回調べられなかった手はそのまま
    expect(r.table.find((c) => c.move === '1g1f')).toEqual({ move: '1g1f', mark: 'alt' });
  });

  it('本命を外していた表では、本命にするはずの手がすでに表にあれば、本命なしのまま', () => {
    const r = mergeResults([{ move: '2g2f', mark: 'alt' }], [res('2g2f', 80, true), res('5g5f', 0)], { goodMax: 150, by });
    expect(r.table.some((c) => c.mark === 'main')).toBe(false);
  });

  it(`${CANDIDATE_MAX} 手まで。表にある手・指した手・研究の手を先に残す`, () => {
    const files = '123456789'.split('');
    const full: Candidate[] = files.slice(0, 6).map((f) => ({ move: `${f}g${f}f`, mark: 'alt' }));
    const r = mergeResults(full, [res('2h3h', 10), res('2h4h', 9), res('2h5h', 8, true), res('2h6h', 7)], { goodMax: 150, by, picked: '2h6h' });
    expect(r.table).toHaveLength(CANDIDATE_MAX);
    expect(r.table.map((c) => c.move)).toEqual(expect.arrayContaining(['2h6h', '2h5h']));
    expect(r.dropped).toBe(2);
  });
});

describe('印の付け替え', () => {
  const table: Candidate[] = [
    { move: '2g2f', mark: 'main', eval: cp(80) },
    { move: '7g7f', mark: 'alt', eval: cp(0) },
  ];

  it('本命は 1 局面に 1 つ（前の本命は次善に）', () => {
    expect(marks(setMark(table, '7g7f', 'main')!)).toEqual([
      ['7g7f', 'main'],
      ['2g2f', 'alt'],
    ]);
  });

  it('表に無い手は足す。null は表から外す', () => {
    expect(marks(setMark(table, '5g5f', 'bad')!)).toContainEqual(['5g5f', 'bad']);
    expect(marks(setMark(table, '7g7f', null)!)).toEqual([['2g2f', 'main']]);
  });

  it('いっぱいの表には足せない', () => {
    const full: Candidate[] = '12345678'.split('').map((f) => ({ move: `${f}g${f}f`, mark: 'alt' }));
    expect(setMark(full, '9g9f', 'bad')).toBeNull();
  });

  it('理由は 200 字まで。空なら消す', () => {
    expect(setReason(table, '7g7f', 'あ'.repeat(250))[1].reason).toHaveLength(200);
    expect(setReason(setReason(table, '7g7f', 'x'), '7g7f', ' ')[1].reason).toBeUndefined();
  });

  it('並びは本命・次善・悪手', () => {
    expect(marks(sortCandidates([{ move: 'a', mark: 'bad' }, { move: 'b', mark: 'alt' }, { move: 'c', mark: 'main' }]))).toEqual([
      ['c', 'main'],
      ['b', 'alt'],
      ['a', 'bad'],
    ]);
  });
});

describe('印の言葉（数は本命との差）', () => {
  const table: Candidate[] = [
    { move: 'a', mark: 'main', eval: cp(45) },
    { move: 'b', mark: 'alt', eval: cp(-35) },
    { move: 'c', mark: 'alt', eval: cp(85) },
    { move: 'd', mark: 'alt', eval: cp(45) },
    { move: 'e', mark: 'bad', eval: { kind: 'mate', plies: -7 } },
    { move: 'f', mark: 'bad' },
  ];

  it('本命・次善 −80・次善 +40・次善 ±0・詰まされる・評価値なし', () => {
    expect(table.map((c) => markText(table, c))).toEqual(['本命', '次善 −80', '次善 +40', '次善 ±0', '悪手（詰まされる）', '悪手']);
  });

  it('本命が無ければ、表の中のいちばん良い点からの差', () => {
    const noMain: Candidate[] = [
      { move: 'a', mark: 'alt', eval: cp(45) },
      { move: 'b', mark: 'bad', eval: cp(-405) },
    ];
    expect(markText(noMain, noMain[1])).toBe('悪手 −450');
  });

  it('KIF のコメントの行', () => {
    const t: Candidate[] = [
      { move: '2g2f', mark: 'main', eval: cp(50) },
      { move: '7g7f', mark: 'alt', eval: cp(-30) },
    ];
    expect(candidatesKifLine(t, STARTPOS_SFEN)).toBe('候補：▲２六歩（本命）、▲７六歩（次善 −80）');
    expect(candidatesKifLine([], STARTPOS_SFEN)).toBe('');
  });
});

describe('前の「このままでよい」の読み替え', () => {
  const moves = [used('5a6b', 3), used('5a5b', 2)];
  const rec = { id: 'white|k', side: 'white' as const, key: 'k', note: '', okMoves: ['5a6b', '5a5b'], updatedAt: 1 };

  it('okMoves は次善。本命は、その中でいちばん最近直した研究手順の手', () => {
    expect(marks(tableOf(rec, moves))).toEqual([
      ['5a6b', 'main'],
      ['5a5b', 'alt'],
    ]);
  });

  it('あとから増えた手は表に入れない（食い違いをまた知らせるため）', () => {
    expect(tableOf(rec, [...moves, used('7a7b', 9)]).map((c) => c.move)).not.toContain('7a7b');
  });

  it('候補の表があれば、それを使う。記録が無ければ空', () => {
    expect(marks(tableOf({ ...rec, okMoves: undefined, candidates: [{ move: '5a5b', mark: 'main' }] }, moves))).toEqual([['5a5b', 'main']]);
    expect(tableOf(undefined, moves)).toEqual([]);
  });
});

describe('食い違いから本命を選ぶ', () => {
  it('選んだ手が本命、ほかの研究の手は次善。付けてある悪手はそのまま、前の本命は次善', () => {
    expect(marks(chooseMain([], ['5a6b', '5a5b'], '5a5b')!)).toEqual([
      ['5a5b', 'main'],
      ['5a6b', 'alt'],
    ]);
    const table: Candidate[] = [
      { move: '5a6b', mark: 'main' },
      { move: '8f8h+', mark: 'bad' },
    ];
    expect(marks(chooseMain(table, ['5a6b', '5a5b'], '5a5b')!)).toEqual([
      ['5a5b', 'main'],
      ['5a6b', 'alt'],
      ['8f8h+', 'bad'],
    ]);
  });
});

describe('形の確かめ', () => {
  const ok: Candidate[] = [{ move: '7g7f', mark: 'main', eval: cp(1), by, pv: ['3c3d', 'P*5e'], hard: true, reason: 'x' }];

  it('指し手の形', () => {
    expect(['7g7f', '8h2b+', 'P*5e'].every(isUsiMove)).toBe(true);
    expect(['', 'resign', '7g7z', 'K*5e', '<b>'].some(isUsiMove)).toBe(false);
  });

  it('正しい表は通る', () => {
    expect(candidatesProblem(ok)).toBeNull();
    expect(candidatesProblem([{ move: 'P*5e', mark: 'bad' }])).toBeNull();
  });

  it.each([
    ['配列でない', 'x'],
    ['多すぎる', '123456789'.split('').map((f) => ({ move: `${f}g${f}f`, mark: 'alt' }))],
    ['指し手', [{ move: 'xx', mark: 'main' }]],
    ['印', [{ move: '7g7f', mark: 'good' }]],
    ['同じ手', [ok[0], { move: '7g7f', mark: 'alt' }]],
    ['本命が 2 つ', [ok[0], { move: '2g2f', mark: 'main' }]],
    ['評価値', [{ move: '7g7f', mark: 'alt', eval: { kind: 'cp', value: 'a' } }]],
    ['条件', [{ move: '7g7f', mark: 'alt', by: { engine: 3, ms: 1, at: 1 } }]],
    ['読み筋', [{ move: '7g7f', mark: 'alt', pv: Array.from({ length: 11 }, () => '3c3d') }]],
    ['理由', [{ move: '7g7f', mark: 'alt', reason: 'あ'.repeat(201) }]],
    ['見えにくい', [{ move: '7g7f', mark: 'alt', hard: 'yes' }]],
  ])('おかしい表：%s', (_name, raw) => {
    expect(candidatesProblem(raw)).not.toBeNull();
  });
});
