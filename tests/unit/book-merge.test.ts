// 段階22-4：定跡帳で、手順前後で同じ局面になった研究手順をつなぐ（持ち主の依頼と判断 2026-11-26）
import { describe, expect, it } from 'vitest';
import { buildBookIndex } from '../../src/games/compare';
import { STARTPOS_SFEN, applyUsiMove } from '../../src/shogi/position';
import { applyChange, cutRow, playInBook, playLineInBook, type BookCtx } from '../../src/tree/bookEdit';
import { bookAtPosition, branchTarget } from '../../src/tree/studyBook';
import type { Study } from '../../src/tree/types';

const study = (id: string, moves: string, patch: Partial<Study> = {}): Study => ({
  id,
  name: id,
  note: '',
  moves: moves.split(' '),
  mySide: 'black',
  createdAt: 1,
  updatedAt: 1,
  ...patch,
});
const sfenAfter = (moves: string[]) => moves.reduce((sfen, m) => applyUsiMove(sfen, m)!.sfen, STARTPOS_SFEN);
const at = (pool: Study[], here: string) => {
  const moves = here ? here.split(' ') : [];
  return bookAtPosition(buildBookIndex(pool, 'black'), moves, sfenAfter(moves));
};
const ctx = (patch: Partial<BookCtx> = {}): BookCtx => ({ templates: [], side: 'black', start: 0, now: 100, newId: () => 'new', fits: () => true, ...patch });

// ▲7六歩 △3四歩 ▲2六歩 と ▲2六歩 △3四歩 ▲7六歩 は同じ局面
const VIA76 = '7g7f 3c3d 2g2f';
const VIA26 = '2g2f 3c3d 7g7f';

describe('同じ局面をつなぐ（bookAtPosition）', () => {
  const a = study('a', `${VIA76} 8c8d`, { updatedAt: 1 });
  const b = study('b', `${VIA26} 4c4d 2f2e`, { updatedAt: 2 });

  it('相手の手番でも、手順前後で来た研究の次の手を合わせて出し、「手順前後」の印を付ける', () => {
    const r = at([a, b], VIA76);
    expect(r.count).toBe(2);
    expect(r.branches.map((x) => [x.move, x.transposed])).toEqual([
      ['4c4d', true],
      ['8c8d', false],
    ]);
  });

  it('自分の手番でも同じ。同じ次の手は 1 行にまとめ、今の手順どおりの研究手順があれば印は付けない', () => {
    const c = study('c', `${VIA26} 8c8d 6i7h`);
    const r = at([a, c], VIA76);
    expect(r.branches).toHaveLength(1);
    expect(r.branches[0].studies.map((s) => s.id).sort()).toEqual(['a', 'c']);
    expect(r.branches[0].transposed).toBe(false);
  });

  it('この局面で終わる研究手順は、手順前後でも「ここで終わる研究」に出す', () => {
    const end = study('e', VIA26);
    expect(at([a, end], VIA76).ending.map((s) => s.id)).toEqual(['e']);
  });

  it('自分の側が違う研究手順はつながない', () => {
    const w = study('w', `${VIA26} 4c4d`, { mySide: 'white' });
    expect(at([a, w], VIA76).branches.map((x) => x.move)).toEqual(['8c8d']);
  });

  it('同じ局面を 2 回通る研究手順（千日手の形）は、今の手順と同じ所を使う', () => {
    const loop = study('l', '5i5h 5a5b 5h5i 5b5a 7g7f');
    const r = at([loop], '');
    expect(r.count).toBe(1);
    expect(r.branches.find((x) => x.move === '5i5h')?.transposed).toBe(false);
  });
});

describe('行を押したときの行き先（branchTarget）', () => {
  const a = study('a', `${VIA76} 8c8d`, { updatedAt: 1 });
  const b = study('b', `${VIA26} 4c4d 2f2e`, { updatedAt: 2 });
  const here = VIA76.split(' ');

  it('今の手順どおりの研究手順があれば、そのまま 1 手進む（今のものを先に）', () => {
    const r = at([a, b], VIA76);
    expect(branchTarget(r.branches.find((x) => x.move === '8c8d')!, here, 'a')).toMatchObject({ study: a, index: 4, switched: false });
  });

  it('手順前後の手は、その研究手順の同じ局面の次へ（手順が切り替わる）', () => {
    const r = at([a, b], VIA76);
    expect(branchTarget(r.branches.find((x) => x.move === '4c4d')!, here, 'a')).toMatchObject({ study: b, index: 4, switched: true });
  });
});

describe('盤で指す（playInBook）', () => {
  const b = study('b', `${VIA26} 4c4d 2f2e`);

  it('ほかの研究手順に同じ局面・同じ次の手があれば、足さずにそちらへ進む', () => {
    const a = study('a', `${VIA76} 8c8d`);
    const r = playInBook([a, b], [a, b], VIA76.split(' '), '4c4d', 'a', ctx());
    expect(r).toMatchObject({ kind: 'advance', target: b, index: 4, switched: true });
  });

  it('今の研究手順がここで終わっていても、同じ局面・同じ手があれば延ばさない', () => {
    const short = study('a', VIA76);
    expect(playInBook([short, b], [short, b], VIA76.split(' '), '4c4d', 'a', ctx()).kind).toBe('advance');
  });

  it('どの研究手順にも無い手は、今まで通り足す', () => {
    const short = study('a', VIA76);
    const r = playInBook([short, b], [short, b], VIA76.split(' '), '8c8d', 'a', ctx());
    expect(r.kind).toBe('extend');
  });

  it('続けて足すとき、途中で切り替わったら、切り替わった先の手順に続ける', () => {
    const a = study('a', VIA76);
    const stop = study('b', `${VIA26} 4c4d`);
    const r = playLineInBook([a, stop], [a, stop], VIA76.split(' '), ['4c4d', '2f2e'], 'a', ctx());
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.study.id).toBe('b');
    expect(r.study.moves.join(' ')).toBe(`${VIA26} 4c4d 2f2e`);
    // 1 手目を指した局面は、切り替わった先の手順で 4 手目
    expect(r.index).toBe(4);
  });
});

describe('行の「この手から先を消す」（cutRow）', () => {
  const row = (pool: Study[], here: string, move: string) => at(pool, here).branches.find((b) => b.move === move)!;
  const cut = (pool: Study[], here: string, move: string) => cutRow(pool, here.split(' '), row(pool, here, move), 'a', ctx())!;

  it('手順前後で来る研究手順も一緒に消す。ほかの手の研究手順は残る', () => {
    const a = study('a', `${VIA76} 8c8d 2f2e`);
    const b = study('b', `${VIA26} 8c8d 6i7h`);
    const other = study('o', `${VIA76} 4c4d`);
    const plan = cut([a, b, other], VIA76, '8c8d');
    expect(plan.count).toBe(2);
    const after = applyChange([a, b, other], plan);
    expect(after.some((s) => s.moves.includes('8c8d'))).toBe(false);
    expect(after.some((s) => s.id === 'o')).toBe(true);
  });

  it('同じ局面を 2 回通って同じ手を指す研究手順は、今の盤の位置で切る（前の所では切らない）', () => {
    // 2 手目と 6 手目が同じ局面で、どちらも次は ▲3八飛
    const loop = study('a', '7g7f 3c3d 2h3h 8b7b 3h2h 7b8b 2h3h 5c5d 5g5f');
    const here = '7g7f 3c3d 2h3h 8b7b 3h2h 7b8b';
    const after = applyChange([loop], cut([loop], here, '2h3h'));
    expect(after.map((s) => s.moves.join(' '))).toEqual([here]);
  });

  it('行に出ていない研究手順（同じ局面の別の回で、その手を指すもの）は消さない', () => {
    const a = study('a', '7g7f 3c3d 9g9f');
    // 同じ局面を 2 回通り、1 回目は ▲3八飛、2 回目は ▲9六歩。行は 1 回目の手を出す
    const loop = study('l', '7g7f 3c3d 2h3h 8b7b 3h2h 7b8b 9g9f');
    const after = applyChange([a, loop], cut([a, loop], '7g7f 3c3d', '9g9f'));
    expect(after.find((s) => s.id === 'l')?.moves).toEqual(loop.moves);
  });
});
