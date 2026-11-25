// 段階21-1：研究手順が通っている手を悪手にするとき、その手から先を消す（手順前後のほかの研究手順も）
import { describe, expect, it } from 'vitest';
import { sfenKey } from '../../src/shogi/position';
import { studyPositions } from '../../src/review/studyReview';
import { cutMoveAt, studiesPlaying } from '../../src/tree/bookEdit';
import type { Study } from '../../src/tree/types';

const study = (id: string, moves: string[], updatedAt = 1, mySide: Study['mySide'] = 'white'): Study => ({ id, name: id, note: '', moves, mySide, createdAt: updatedAt, updatedAt });
const ctx = { templates: [], now: 100, start: 0, side: 'white' as const };

describe('その局面でその手を指す研究手順を消す', () => {
  // ▲7六歩 △3四歩 ▲2六歩 と ▲2六歩 △3四歩 ▲7六歩 は 3 手目で同じ局面
  const x = study('x', ['7g7f', '3c3d', '2g2f', '8c8d'], 3);
  const y = study('y', ['2g2f', '3c3d', '7g7f', '8c8d', '2f2e'], 2);
  const z = study('z', ['7g7f', '3c3d', '2g2f', '4a3b'], 1);
  const other = study('other', ['7g7f', '3c3d', '2g2f', '8c8d'], 1, 'black');
  const key = sfenKey(studyPositions(x.moves)[3]);

  it('手順前後も数える。自分の側が違う研究手順は数えない', () => {
    expect(studiesPlaying([x, y, z, other], 'white', key, '8c8d').map((s) => s.id).sort()).toEqual(['x', 'y']);
  });

  it('その手から先を消す。その局面を通る研究手順が無くなる手順は、その局面で終わる 1 本を残す', () => {
    const plan = cutMoveAt([x, y, z, other], 'white', key, '8c8d', 'x', ctx)!;
    expect(plan.count).toBe(2);
    // x の手順は z が同じ局面を通るので消える。y の手順は、その局面で終わる形で残る
    expect(plan.remove.map((s) => s.id)).toEqual(['x']);
    expect(plan.put.map((s) => [s.id, s.moves.length])).toEqual([['y', 3]]);
  });

  it('その手を指す研究手順が無ければ null', () => {
    expect(cutMoveAt([z], 'white', key, '8c8d', null, ctx)).toBeNull();
  });
});
