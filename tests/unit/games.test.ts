// 段階18：実戦の棋譜を読む・定跡帳と照らし合わせる（4 種類の外れ方・手順前後・次に研究する所・集計）
import { describe, expect, it } from 'vitest';
import { buildBookIndex, classifyGame, matchGames, nextSpots, summarizeGames } from '../../src/games/compare';
import { gameProblem, parseGame, parseKifDate, sameGame, sideByName, type Game } from '../../src/games/game';
import { BUNDLED_TEMPLATES } from '../../src/tree/templates';
import type { Study } from '../../src/tree/types';

// 将棋ウォーズからコピーした棋譜と同じ形（対局者名は仮のもの）。横歩取りの青野流
const WARS_LINES = [
  '７六歩(77)', '３四歩(33)', '２六歩(27)', '８四歩(83)', '２五歩(26)', '８五歩(84)', '７八金(69)', '３二金(41)', '２四歩(25)', '２四歩(23)',
  '２四飛(28)', '８六歩(85)', '８六歩(87)', '８六飛(82)', '３四飛(24)', '３三角(22)', '５八玉(59)', '６二玉(51)', '３六歩(37)', '８二歩打',
  '３七桂(29)', '８八飛成(86)', '８八銀(79)',
];
/** 上の手（USI） */
const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c 5i5h 5a6b 3g3f P*8b 2i3g 8f8h+ 7i8h'.split(' ');

function warsKif(lines: string[], ending: string): string {
  return [
    '開始日時：2026/11/08 11:57:50',
    '終了日時：2026/11/08 12:03:50',
    '場所：将棋ウォーズ',
    '持ち時間：3分切れ負け',
    '手合割：平手',
    '初期局面：通常',
    '先手：sente_user',
    '先手段級：七段',
    '後手：Gote_User',
    '後手段級：六段',
    '手数----指手---------消費時間--',
    ...lines.map((m, i) => `${i + 1} ${m}   ( 0:01/00:00:0${i % 10})`),
    `${lines.length + 1} ${ending}`,
    '',
  ].join('\n');
}

const study = (id: string, moves: string[], mySide: Study['mySide'] = 'white', updatedAt = 1): Study => ({
  id,
  name: id,
  note: '',
  moves,
  mySide,
  createdAt: 1,
  updatedAt,
});

const game = (moves: string[], mySide: Game['mySide'] = 'white', playedAt = 1, id = 'g'): Game => ({
  id,
  kifu: '',
  moves,
  black: { name: 'a' },
  white: { name: 'b' },
  playedAt,
  mySide,
  winner: null,
  addedAt: playedAt,
});

describe('将棋ウォーズの棋譜を読む', () => {
  it('対局者・段級・日時・持ち時間・手・勝ち負け（投了した手番の側の負け）', () => {
    const r = parseGame(warsKif(WARS_LINES, '投了'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.draft.moves).toEqual(G1);
    expect(r.draft.black).toEqual({ name: 'sente_user', rank: '七段' });
    expect(r.draft.white).toEqual({ name: 'Gote_User', rank: '六段' });
    expect(r.draft.playedAt).toBe(new Date(2026, 10, 8, 11, 57, 50).getTime());
    expect(r.draft.timeLimit).toBe('3分切れ負け');
    // 23 手指して 24 手目が投了 → 後手の手番で投了 → 先手の勝ち
    expect(r.draft.ending).toBe('投了');
    expect(r.draft.winner).toBe('black');
    const r2 = parseGame(warsKif(WARS_LINES.slice(0, 22), '投了'));
    expect(r2.ok && r2.draft.winner).toBe('white');
    const r3 = parseGame(warsKif(WARS_LINES.slice(0, 22), '切れ負け'));
    expect(r3.ok && [r3.draft.ending, r3.draft.winner]).toEqual(['切れ負け', 'white']);
    const r4 = parseGame(warsKif(WARS_LINES.slice(0, 22), '千日手'));
    expect(r4.ok && r4.draft.winner).toBe('draw');
  });

  it('自分の側：ユーザー名で決める（大文字・小文字は区別しない）。合わなければ null', () => {
    const r = parseGame(warsKif(WARS_LINES, '投了'));
    if (!r.ok) throw new Error(r.message);
    expect(sideByName(r.draft, 'gote_user')).toBe('white');
    expect(sideByName(r.draft, ' SENTE_USER ')).toBe('black');
    expect(sideByName(r.draft, 'someone')).toBeNull();
    expect(sideByName(r.draft, '')).toBeNull();
  });

  it('読めない棋譜・平手でない棋譜・指し手の無い棋譜は理由を出す', () => {
    expect(parseGame('').ok).toBe(false);
    const handicap = parseGame('手合割：香落ち\n手数----指手---------消費時間--\n1 ３四歩(33)\n');
    expect(!handicap.ok && handicap.message).toContain('平手');
    const empty = parseGame('手合割：平手\n手数----指手---------消費時間--\n1 投了\n');
    expect(!empty.ok && empty.message).toContain('指し手がありません');
  });

  it('同じ実戦（同じ手・日時・対局者）を見分ける。日時の読み取り', () => {
    const a = game(G1, 'white', 5);
    const copy: Game = { ...a, id: 'other' };
    expect(sameGame(a, copy)).toBe(true);
    expect(sameGame(a, { ...a, playedAt: 6 })).toBe(false);
    expect(sameGame(a, { ...a, moves: G1.slice(0, 5) })).toBe(false);
    expect(parseKifDate('2026/11/02 10:08:04')).toBe(new Date(2026, 10, 2, 10, 8, 4).getTime());
    expect(parseKifDate('なし')).toBeUndefined();
  });

  it('バックアップから読んだ 1 局の形を確かめる', () => {
    expect(gameProblem(game(G1))).toBeNull();
    expect(gameProblem({ ...game(G1), mySide: 'x' })).toBe('自分の側');
    expect(gameProblem({ ...game(G1), moves: [] })).toBe('手');
    expect(gameProblem({ ...game(G1), black: { name: 3 } })).toBe('対局者');
  });
});

describe('照らし合わせ', () => {
  const T = BUNDLED_TEMPLATES;
  const research = study('s-1', [...G1.slice(0, 20), '3i3h', '7a7b']);

  it('相手が研究にない手：研究通り 20 手目まで。開く手順は研究手順の手順＋相手の手', () => {
    const m = classifyGame(game(G1), buildBookIndex([research], 'white'), T);
    expect(m.kind).toBe('opp');
    expect(m.matched).toBe(20);
    expect(m.bookMoves).toEqual([{ move: '3i3h', count: 1 }]);
    expect(m.openLine).toEqual([...G1.slice(0, 20), '2i3g']);
  });

  it('自分が研究と違う手：研究の手と、開く研究手順', () => {
    const other = study('s-2', [...G1.slice(0, 17), '5a5b', '3g3f']);
    const m = classifyGame(game(G1), buildBookIndex([other], 'white'), T);
    expect(m.kind).toBe('mine');
    expect(m.matched).toBe(17);
    expect(m.bookMoves.map((b) => b.move)).toEqual(['5a5b']);
    expect(m.study).toEqual({ id: 's-2', ply: 17 });
  });

  it('研究の先まで進んだ・研究の途中で終局', () => {
    const short = study('s-3', G1.slice(0, 19));
    const beyond = classifyGame(game(G1), buildBookIndex([short], 'white'), T);
    expect([beyond.kind, beyond.matched, beyond.study]).toEqual(['beyond', 19, { id: 's-3', ply: 19 }]);
    const finished = classifyGame(game(G1.slice(0, 10)), buildBookIndex([research], 'white'), T);
    expect([finished.kind, finished.matched]).toEqual(['finished', 10]);
  });

  it('最初から研究の外：戦型の出発点（後手番の横歩取りは 16 手目）より手前で外れた・研究が無い', () => {
    const shiken = game(['7g7f', '3c3d', '6g6f', '8c8d']);
    const m = classifyGame(shiken, buildBookIndex([research], 'white'), T);
    expect([m.kind, m.matched]).toEqual(['outside', 2]);
    const none = classifyGame(shiken, buildBookIndex([], 'white'), T);
    expect([none.kind, none.matched, none.openLine]).toEqual(['outside', 0, ['7g7f']]);
    // 自分の側が違う研究手順は使わない
    const black = classifyGame(game(G1), buildBookIndex([{ ...research, mySide: 'black' }], 'white'), T);
    expect(black.kind).toBe('outside');
  });

  it('手順前後で同じ局面になっても研究通り。開く手順は定跡帳にある手順', () => {
    const swapped = study('s-4', ['2g2f', '3c3d', '7g7f', '8c8d', '2f2e', '8d8e', '6i7h', '4a3b', '2e2d', '2c2d', '2h2d', '8e8f', '8g8f', '8b8f', '2d3d', '2b3c', '5i5h', '5a6b', '3i3h']);
    const m = classifyGame(game(G1), buildBookIndex([swapped], 'white'), T);
    expect(m.kind).toBe('opp');
    expect(m.matched).toBe(18);
    expect(m.openLine).toEqual([...swapped.moves.slice(0, 18), '3g3f']);
  });

  it('研究を足すと結果が変わる', () => {
    const before = classifyGame(game(G1), buildBookIndex([research], 'white'), T);
    const added = study('s-5', [...G1.slice(0, 21), '8f8h+'], 'white', 2);
    const after = classifyGame(game(G1), buildBookIndex([research, added], 'white'), T);
    expect([before.kind, before.matched]).toEqual(['opp', 20]);
    expect([after.kind, after.matched]).toEqual(['beyond', 22]);
  });
});

describe('実戦の一覧の集計と次に研究する所', () => {
  it('同じ局面・同じ相手の手を数え、多い順・最近の順。平均は「最初から研究の外」を除く', () => {
    const research = study('s-1', [...G1.slice(0, 20), '3i3h', '7a7b']);
    const early = study('s-2', [...G1.slice(0, 18), '3i3h']);
    const games = [
      game(G1, 'white', 10, 'a'),
      game(G1, 'white', 20, 'b'),
      game([...G1.slice(0, 18), '9g9f', '9c9d'], 'white', 30, 'c'),
      game(['7g7f', '3c3d', '6g6f'], 'white', 40, 'd'),
    ];
    const list = matchGames(games, [research, early], BUNDLED_TEMPLATES);
    expect(list.map((g) => g.game.id)).toEqual(['d', 'c', 'b', 'a']);
    const spots = nextSpots(list);
    expect(spots.map((s) => [s.count, s.latest.game.id])).toEqual([
      [2, 'b'],
      [1, 'c'],
    ]);
    // c は 19 手目 ▲9六歩で外れた（研究通り 18 手目まで）。a・b は 20 手目まで
    expect(summarizeGames(list)).toEqual({ games: 4, averageMatched: (18 + 20 + 20) / 3, opp: 3 });
  });
});
