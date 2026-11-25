// 段階21-2：悪手の咎め方の局面の並びと、稽古で指した手の判定
import { describe, expect, it } from 'vitest';
import { judgeAnswer } from '../../src/practice/practice';
import { STARTPOS_SFEN, applyUsiMove } from '../../src/shogi/position';
import { refutation, type Candidate } from '../../src/tree/candidates';
import type { Study } from '../../src/tree/types';

const after = (...moves: string[]) => moves.reduce((s, m) => applyUsiMove(s, m)!.sfen, STARTPOS_SFEN);

describe('咎め方', () => {
  it('悪手を指した局面から、読み筋を 1 手ずつ', () => {
    const r = refutation(STARTPOS_SFEN, { move: '9g9f', pv: ['3c3d', '7g7f'] })!;
    expect(r.moves).toEqual(['9g9f', '3c3d', '7g7f']);
    expect(r.sfens).toEqual([after('9g9f'), after('9g9f', '3c3d'), after('9g9f', '3c3d', '7g7f')]);
    expect(r.texts).toEqual(['△３四歩', '▲７六歩']);
  });

  it('指せない手があれば、その手前まで。読み筋が無ければ悪手の局面だけ', () => {
    expect(refutation(STARTPOS_SFEN, { move: '9g9f', pv: ['3c3d', '1a1b+', '7g7f'] })!.texts).toEqual(['△３四歩']);
    expect(refutation(STARTPOS_SFEN, { move: '9g9f' })!.moves).toEqual(['9g9f']);
  });

  it('悪手そのものが指せなければ null', () => {
    expect(refutation(STARTPOS_SFEN, { move: '5a5b', pv: [] })).toBeNull();
  });
});

describe('稽古で指した手の判定', () => {
  const table: Candidate[] = [
    { move: 'm', mark: 'main' },
    { move: 'a', mark: 'alt' },
    { move: 'b', mark: 'bad' },
  ];
  const other = { id: 'x', name: 'ほか' } as Study;

  it('この研究の手は正解（表で悪手でも）', () => {
    expect(judgeAnswer('m', 'm', table, null)).toEqual({ kind: 'correct' });
    expect(judgeAnswer('b', 'b', table, null)).toEqual({ kind: 'correct' });
  });

  it('表の本命・次善は、まちがいにしない', () => {
    expect(judgeAnswer('m', 'z', table, null)).toMatchObject({ kind: 'near', mark: 'main', other: null });
    expect(judgeAnswer('a', 'm', table, other)).toMatchObject({ kind: 'near', mark: 'alt', entry: table[1], other });
  });

  it('悪手はまちがい（ほかの研究手順が通っていても）', () => {
    expect(judgeAnswer('b', 'm', table, other)).toEqual({ kind: 'bad', entry: table[2] });
  });

  it('表に無いほかの研究手順の手は次善。どちらでもなければまちがい', () => {
    expect(judgeAnswer('o', 'm', table, other)).toEqual({ kind: 'near', mark: 'alt', entry: undefined, other });
    expect(judgeAnswer('o', 'm', table, null)).toEqual({ kind: 'wrong' });
  });
});
