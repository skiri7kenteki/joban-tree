// 段階9-2：研究手順をつないだツリー（自分の定跡帳）
import { describe, expect, it } from 'vitest';
import { importKIF } from 'tsshogi';
import { bookAt, bookOrder, bookStart, switchTarget } from '../../src/tree/studyBook';
import { studiesToKif } from '../../src/tree/studyFile';
import type { Study } from '../../src/tree/types';

const study = (id: string, moves: string[], updatedAt = 1): Study => ({
  id,
  name: id,
  note: '',
  moves,
  mySide: 'black',
  createdAt: 1,
  updatedAt,
});

describe('つないだツリーの組み立て', () => {
  const a = study('A', ['7g7f', '3c3d', '2g2f', '8c8d'], 10);
  const b = study('B', ['7g7f', '3c3d', '6g6f'], 20);
  const c = study('C', ['7g7f', '3c3d', '6g6f', '8c8d'], 30);
  const d = study('D', ['7g7f', '3c3d'], 5);

  it('共通の手順でつながる：次の手ごとに、研究手順の多い手が上。研究手順の数。ここで終わる研究', () => {
    const here = bookAt([a, b, c, d], ['7g7f', '3c3d']);
    expect(here.count).toBe(4);
    expect(here.branches.map((x) => [x.move, x.studies.map((s) => s.id)])).toEqual([
      ['6g6f', ['C', 'B']], // 2 本・いちばん最近直した C が先
      ['2g2f', ['A']],
    ]);
    expect(here.ending.map((s) => s.id)).toEqual(['D']);
    // 初期局面からは 1 つの手に 4 本
    expect(bookAt([a, b, c, d], []).branches.map((x) => [x.move, x.studies.length])).toEqual([['7g7f', 4]]);
    // B の終わり：C だけが続く
    const atB = bookAt([a, b, c, d], b.moves);
    expect(atB.count).toBe(2);
    expect(atB.ending.map((s) => s.id)).toEqual(['B']);
    expect(atB.branches.map((x) => x.move)).toEqual(['8c8d']);
  });

  it('研究手順の数が同じなら、いちばん最近直した研究手順のある手が上', () => {
    const x = study('X', ['7g7f', '3c3d'], 1);
    const y = study('Y', ['7g7f', '8c8d'], 9);
    expect(bookAt([x, y], ['7g7f']).branches.map((br) => br.move)).toEqual(['8c8d', '3c3d']);
  });

  it('手順前後で同じ局面に合流してもつながない（平手からの手順がまったく同じ部分だけ）', () => {
    // ▲7六歩 △3四歩 ▲2六歩 と ▲2六歩 △3四歩 ▲7六歩 は同じ局面だが、手順が違う
    const p = study('P', ['7g7f', '3c3d', '2g2f', '8c8d']);
    const q = study('Q', ['2g2f', '3c3d', '7g7f', '4a3b']);
    const atP = bookAt([p, q], ['7g7f', '3c3d', '2g2f']);
    expect(atP.count).toBe(1);
    expect(atP.branches.map((br) => br.studies.map((s) => s.id))).toEqual([['P']]);
    expect(bookAt([p, q], []).branches.map((br) => br.move).sort()).toEqual(['2g2f', '7g7f']);
  });

  it('次の手を押したときに切り替える研究手順：その手を通るもののうち、いちばん最近直したもの', () => {
    const here = bookAt([a, b, c, d], ['7g7f', '3c3d']);
    expect(switchTarget(here.branches[0]).id).toBe('C');
    expect(switchTarget(here.branches[1]).id).toBe('A');
  });
});

describe('定跡帳の出発点（段階10 の直し：研究を足しても奥へずれない）', () => {
  // 横歩取りと同じ形：基本図（15 手・先手番）→ △3三角（16 手・後手番）→ ▲3六飛 まで（17 手・先手番）、△8八角成（16 手目から・後手番の相横歩取り）
  const YOKOFU = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d'.split(' ');
  const kihon = { moves: YOKOFU, mySide: 'black' as const };
  const kakuGote = { moves: [...YOKOFU, '2b3c'], mySide: 'white' as const };
  const kaku36 = { moves: [...YOKOFU, '2b3c', '3d3f'], mySide: 'black' as const };
  const aiyokofu = { moves: [...YOKOFU, '2b8h+', '7i8h', '8f7f'], mySide: 'white' as const };
  const TPL = [kihon, kakuGote, kaku36, aiyokofu];

  it('後手番：研究手順が 1 本でも、全部が通る後手番の戦型のうちいちばん浅いもの（16 手目 △3三角）。先手番向けの ▲3六飛 まで（17 手）にずれない', () => {
    const s = study('1', [...kaku36.moves]);
    expect(bookStart([s], TPL, 'white')).toBe(16);
    expect(bookStart([s, study('2', [...kaku36.moves, '8f8d', '3f2f'])], TPL, 'white')).toBe(16);
  });

  it('先手番：全部が通る先手番の戦型のうちいちばん浅いもの（15 手目 基本図）。1 本だけでも、▲3六飛 まで（17 手）にずれない', () => {
    expect(bookStart([study('1', [...kaku36.moves, '8f8d'])], TPL, 'black')).toBe(15);
    expect(bookStart([study('1', [...kaku36.moves, '8f8d']), study('2', [...aiyokofu.moves, '7g7f'])], TPL, 'black')).toBe(15);
  });

  it('自分の側が同じ戦型で全部が通るものが無ければ、側を問わずいちばん浅いもの。それも無ければ 0', () => {
    // 後手番で △3三角 と 相横歩取り：後手番の戦型は全部には通らない → 基本図（15 手）
    expect(bookStart([study('1', [...kakuGote.moves, '3d3f']), study('2', [...aiyokofu.moves])], TPL, 'white')).toBe(15);
    expect(bookStart([study('3', ['5g5f'])], TPL, 'black')).toBe(0);
    expect(bookStart([], TPL, 'black')).toBe(0);
  });
});

describe('変化付き KIF の書き出し（定跡帳の並び）', () => {
  it('本譜は研究手順の多い手をたどった研究手順。変化も画面と同じ並び。ここで終わる研究は先の研究手順の後', () => {
    const a = study('A', ['7g7f', '3c3d', '2g2f', '8c8d'], 10);
    const b = study('B', ['7g7f', '3c3d', '6g6f'], 20);
    const c = study('C', ['7g7f', '3c3d', '6g6f', '8c8d'], 30);
    const d = study('D', ['7g7f', '3c3d'], 50);
    const e = study('E', ['7g7f', '3c3d', '6g6f', '4a3b'], 1);
    const order = bookOrder([a, b, c, d, e]);
    // 3 手目：▲6六歩（B・C・E の 3 本）が本譜、▲2六歩（A）が変化。4 手目：△8四歩（C）→ △3二金（E）。B・D はその局面の後
    expect(order.map((s) => s.id)).toEqual(['C', 'E', 'B', 'A', 'D']);

    const record = importKIF(studiesToKif(order, '定跡帳'));
    if (record instanceof Error) throw record;
    const usi = (n: { move: unknown }) => (n.move && typeof n.move === 'object' && 'usi' in n.move ? (n.move as { usi: string }).usi : '');
    expect(record.moves.slice(1).map(usi)).toEqual(c.moves);
    // 3 手目の変化は ▲2六歩、4 手目の変化は △3二金
    expect(record.moves[3].branch ? usi(record.moves[3].branch) : '').toBe('2g2f');
    expect(record.moves[4].branch ? usi(record.moves[4].branch) : '').toBe('4a3b');
    // ここで終わる研究の名前は、その局面の手のコメント
    expect(record.moves[2].comment).toContain('★D');
    expect(record.moves[3].comment).toContain('★B');
  });
});
