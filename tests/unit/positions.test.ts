// 段階20-1：局面メモと食い違いの知らせ（食い違いを探す・手順前後・このままでよい・稽古のほかの研究の手・形の確かめ・KIF の局面メモ）
import { describe, expect, it } from 'vitest';
import { buildBookIndex } from '../../src/games/compare';
import { studyPositions } from '../../src/review/studyReview';
import { bookIndexes, conflictAt, findConflicts, isAcknowledged, isEmptyRecord, otherStudyAt, positionId, positionProblem, type PositionNote } from '../../src/tree/positions';
import { studiesToKif } from '../../src/tree/studyFile';
import type { Study } from '../../src/tree/types';

const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
const study = (id: string, moves: string[], updatedAt = 1, mySide: Study['mySide'] = 'white'): Study => ({ id, name: id, note: '', moves, mySide, createdAt: 1, updatedAt });

describe('食い違い', () => {
  // 17手目 ▲5八玉 の後（後手の手番）に、△6二玉 と △5二玉
  const a = study('a', [...G1, '5i5h', '5a6b', '3g3f'], 3);
  const b = study('b', [...G1, '5i5h', '5a5b'], 2);
  const c = study('c', [...G1, '3d3f', '8f8d'], 1);

  it('自分の手番の同じ局面で、研究手順によって自分の手が違うところを探す', () => {
    const list = findConflicts(bookIndexes([a, b, c]), new Map());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ side: 'white', ply: 17, ok: false });
    expect(list[0].moves.map((m) => m.move).sort()).toEqual(['5a5b', '5a6b']);
    expect(list[0].sfen).toBe(studyPositions(a.moves)[17]);
  });

  it('相手の手番で分かれるのは食い違いではない（▲5八玉 と ▲3六飛）。自分の側が違う研究手順どうしも比べない', () => {
    expect(findConflicts(bookIndexes([a, c]), new Map())).toEqual([]);
    const otherSide = study('d', [...G1, '5i5h', '5a5b'], 1, 'black');
    expect(findConflicts(bookIndexes([a, otherSide]), new Map())).toEqual([]);
  });

  it('手順前後で同じ局面に来ても食い違い', () => {
    // 1. ▲7六歩 △3四歩 ▲2六歩 と ▲2六歩 △3四歩 ▲7六歩 は 3 手目で同じ局面（後手の手番）
    const x = study('x', ['7g7f', '3c3d', '2g2f', '8c8d']);
    const y = study('y', ['2g2f', '3c3d', '7g7f', '4a3b']);
    const list = findConflicts(bookIndexes([x, y]), new Map());
    expect(list).toHaveLength(1);
    expect(list[0].ply).toBe(3);
    const at = conflictAt(buildBookIndex([x, y], 'white'), 'white', studyPositions(y.moves)[3], new Map());
    expect(at?.moves.map((m) => m.move).sort()).toEqual(['4a3b', '8c8d']);
  });

  it('「このままでよい」にした手だけなら知らせない。手が増えたらまた知らせる', () => {
    const [conf] = findConflicts(bookIndexes([a, b]), new Map());
    const rec: PositionNote = { id: conf.id, side: 'white', key: conf.id.slice(6), note: '', okMoves: conf.moves.map((m) => m.move), updatedAt: 1 };
    expect(findConflicts(bookIndexes([a, b]), new Map([[rec.id, rec]]))[0].ok).toBe(true);
    const e = study('e', [...G1, '5i5h', '7a7b'], 1);
    expect(findConflicts(bookIndexes([a, b, e]), new Map([[rec.id, rec]]))[0].ok).toBe(false);
    expect(isAcknowledged(undefined, ['x'])).toBe(false);
  });

  it('稽古：ほかの研究手順の自分の手なら、その研究手順（自分自身は除く）', () => {
    const index = buildBookIndex([a, b], 'white');
    const sfen = studyPositions(a.moves)[17];
    expect(otherStudyAt(index, sfen, '5a5b', 'a')?.id).toBe('b');
    expect(otherStudyAt(index, sfen, '5a6b', 'a')).toBeNull();
    expect(otherStudyAt(index, sfen, '7a7b', 'a')).toBeNull();
  });
});

describe('局面メモ', () => {
  it('id は 側|手数を除いた局面', () => {
    const s = studyPositions(G1)[16];
    expect(positionId('white', s)).toBe(`white|${s.replace(/ \d+$/, '')}`);
  });

  it('形を確かめる', () => {
    const ok = { id: 'white|k', side: 'white', key: 'k', note: 'メモ', updatedAt: 1 };
    expect(positionProblem(ok)).toBeNull();
    expect(positionProblem({ ...ok, id: 'black|k' })).toBe('id');
    expect(positionProblem({ ...ok, note: 3 })).toBe('メモ');
    expect(positionProblem({ ...ok, okMoves: 'x' })).toBe('手');
    expect(positionProblem({ ...ok, updatedAt: 'x' })).toBe('日時');
    expect(isEmptyRecord({ note: ' ', okMoves: [] })).toBe(true);
    expect(isEmptyRecord({ note: '', okMoves: ['7g7f'] })).toBe(false);
  });

  it('定跡帳の KIF の書き出しに局面メモ（手順前後の 2 回目は書かない）。★名前はコメントの先頭', () => {
    const s1 = study('s1', ['7g7f', '3c3d', '2g2f']);
    const s2 = study('s2', ['2g2f', '3c3d', '7g7f']);
    const target = studyPositions(s1.moves)[3].replace(/ \d+$/, '');
    const kif = studiesToKif([s1, s2], '定跡帳', (sfen) => (sfen.replace(/ \d+$/, '') === target ? '大事な局面' : ''));
    expect(kif.match(/局面メモ：大事な局面/g)).toHaveLength(1);
    expect(kif).toMatch(/\*★s1\n\*局面メモ：大事な局面/);
  });
});
