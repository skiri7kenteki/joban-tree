// 実戦と定跡帳の照らし合わせ（段階18、v0.42.0〜。持ち主の依頼書 stage18-prompt・判断 2026-11-23「おすすめの通りで」）。エンジンは使わない。
// 結果は保存せず、開くたびに今の定跡帳で計算し直す（研究を足すと結果が変わる）。
//
// - 定跡帳（自分の側が同じ研究手順すべて。平手から）を**局面（手数を除いた SFEN）で**引けるようにする（buildBookIndex）。
//   手順前後で同じ局面になっても研究通りとみなす
// - 実戦の手を初手から 1 手ずつたどり、定跡帳にある**いちばん後の**局面 P（平手から k 手目）を探す。「研究通り k 手目まで」。
//   途中の局面が定跡帳に無くても、手順前後で定跡帳の局面に戻ってくれば研究通り（7六歩・3四歩・2六歩 と 2六歩・3四歩・7六歩 は 3 手目で同じ局面）
// - 外れ方（classifyGame）：
//   - P で実戦が終わった：研究の続きがあれば「研究の途中で終局」（finished）、無ければ「研究の先まで」（beyond）
//   - P に研究の続きが無い（研究手順がそこで終わっている）→ 研究の先まで進んだ（beyond）
//   - P が戦型の出発点（P を通る研究手順の、自分の側が同じ、いちばん浅い戦型。いちばん浅いものを使う）より手前 → 最初から研究の外（outside）
//   - P で相手の手番 → 相手が研究にない手（opp）。P で自分の手番 → 自分が研究と違う手（mine）
// - 「自分が研究と違う手」の印は保存しない（段階19 の稽古は、実戦の棋譜からこの計算で拾う。持ち主の判断）

import { sfenKey, sideToMove, type Side } from '../shogi/position';
import { studyPositions } from '../review/studyReview';
import { closestTemplate, type OpeningTemplate } from '../tree/templates';
import { startTemplate } from '../tree/studies';
import type { Study } from '../tree/types';
import { gameTime, type Game } from './game';

/** 定跡帳の 1 局面 */
export interface BookEntry {
  /** 次の手 → その手を指す研究手順 */
  next: Map<string, Study[]>;
  /** この局面を通る研究手順と、そこが何手目か */
  through: { study: Study; ply: number }[];
}

/** 局面のキー → 定跡帳の局面 */
export type BookIndex = Map<string, BookEntry>;

/** 自分の側が side の研究手順から、局面で引ける定跡帳を作る */
export function buildBookIndex(studies: readonly Study[], side: Side): BookIndex {
  const index: BookIndex = new Map();
  for (const study of studies) {
    if (study.mySide !== side) continue;
    const positions = studyPositions(study.moves);
    positions.forEach((sfen, ply) => {
      const key = sfenKey(sfen);
      let entry = index.get(key);
      if (!entry) index.set(key, (entry = { next: new Map(), through: [] }));
      entry.through.push({ study, ply });
      if (ply < study.moves.length && ply < positions.length - 1) {
        const move = study.moves[ply];
        const list = entry.next.get(move);
        if (list) list.push(study);
        else entry.next.set(move, [study]);
      }
    });
  }
  return index;
}

export type MatchKind = 'opp' | 'mine' | 'beyond' | 'outside' | 'finished';

/** 外れ方の名前（印に出す） */
export const KIND_TEXT: Record<MatchKind, string> = {
  opp: '相手が研究にない手',
  mine: '自分が研究と違う手',
  beyond: '研究の先まで',
  outside: '最初から研究の外',
  finished: '研究の途中で終局',
};

/** 研究の次の手 1 つ（その手を指す研究手順の数） */
export interface BookMove {
  move: string;
  count: number;
}

/** 1 局の照らし合わせの結果 */
export interface GameMatch {
  kind: MatchKind;
  /** 研究通り何手目まで（定跡帳にあるいちばん後の局面 P の手数。無ければ 0） */
  matched: number;
  /** P での研究の次の手（研究手順の多い順） */
  bookMoves: BookMove[];
  /**
   * 定跡帳を開く手順（平手から）。opp・outside：P までの研究手順の手順＋実戦の次の手（手順前後でも、定跡帳にある手順で開く）。
   * P が定跡帳に無い（研究が 1 本も無い）ときは実戦の 1 手目まで
   */
  openLine?: string[];
  /** 定跡帳で開く研究手順とその手数（mine：研究の手のある研究手順の P、beyond・finished：P で終わる・通る研究手順） */
  study?: { id: string; ply: number };
}

const byLatest = (a: Study, b: Study) => b.updatedAt - a.updatedAt;

/** 1 局を照らし合わせる */
export function classifyGame(game: Pick<Game, 'moves' | 'mySide'>, index: BookIndex, templates: readonly OpeningTemplate[]): GameMatch {
  const positions = studyPositions(game.moves);
  let k = -1;
  for (let i = 0; i < positions.length; i++) {
    if (index.has(sfenKey(positions[i]))) k = i;
  }
  if (k < 0) return { kind: 'outside', matched: 0, bookMoves: [], openLine: game.moves.slice(0, 1) };

  const entry = index.get(sfenKey(positions[k]))!;
  const bookMoves = [...entry.next]
    .map(([move, list]) => ({ move, count: list.length, latest: Math.max(...list.map((s) => s.updatedAt)) }))
    .sort((a, b) => b.count - a.count || b.latest - a.latest)
    .map(({ move, count }) => ({ move, count }));
  const latestThrough = [...entry.through].sort((a, b) => byLatest(a.study, b.study))[0];
  const here = { id: latestThrough.study.id, ply: latestThrough.ply };

  if (k === positions.length - 1) return { kind: bookMoves.length > 0 ? 'finished' : 'beyond', matched: k, bookMoves, study: here };
  if (bookMoves.length === 0) return { kind: 'beyond', matched: k, bookMoves, study: here };

  const openLine = [...latestThrough.study.moves.slice(0, latestThrough.ply), game.moves[k]];
  const start = Math.min(...entry.through.map((t) => startTemplate(t.study.moves, game.mySide, templates)?.moves.length ?? 0));
  if (k < start) return { kind: 'outside', matched: k, bookMoves, openLine };
  if (sideToMove(positions[k]) !== game.mySide) return { kind: 'opp', matched: k, bookMoves, openLine };

  // 自分が研究と違う手：研究の手を指す研究手順のうち、いちばん最近直したもの
  const mineStudy = [...entry.next.values()].flat().sort(byLatest)[0];
  const ply = entry.through.find((t) => t.study.id === mineStudy.id)?.ply ?? k;
  return { kind: 'mine', matched: k, bookMoves, study: { id: mineStudy.id, ply } };
}

/** 実戦の戦型のグループ名（自分の側が同じ戦型を先に。分からなければ空） */
export function gameGroup(game: Pick<Game, 'moves' | 'mySide'>, templates: readonly OpeningTemplate[]): string {
  const t = closestTemplate(templates.filter((x) => x.mySide === game.mySide), game.moves) ?? closestTemplate(templates, game.moves);
  return t?.group ?? '';
}

/** 実戦 1 局と、その照らし合わせ */
export interface MatchedGame {
  game: Game;
  match: GameMatch;
}

/** 全部の実戦を照らし合わせる（側ごとに定跡帳を 1 回だけ作る）。並びは対局の新しい順 */
export function matchGames(games: readonly Game[], studies: readonly Study[], templates: readonly OpeningTemplate[]): MatchedGame[] {
  const indexes: Partial<Record<Side, BookIndex>> = {};
  const indexOf = (side: Side) => (indexes[side] ??= buildBookIndex(studies, side));
  return [...games]
    .sort((a, b) => gameTime(b) - gameTime(a) || b.addedAt - a.addedAt)
    .map((game) => ({ game, match: classifyGame(game, indexOf(game.mySide), templates) }));
}

/** 一覧の上の集計の対象（最近の何局か） */
export const RECENT_GAMES = 20;

export interface GamesSummary {
  /** 最近の実戦の数（20 局まで） */
  games: number;
  /** 研究通りの平均手数（「最初から研究の外」を除く。無ければ null） */
  averageMatched: number | null;
  /** 「相手が研究にない手」の回数 */
  opp: number;
}

/** 最近 20 局の集計（list は新しい順） */
export function summarizeGames(list: readonly MatchedGame[]): GamesSummary {
  const recent = list.slice(0, RECENT_GAMES);
  const inBook = recent.filter((g) => g.match.kind !== 'outside');
  const averageMatched = inBook.length > 0 ? inBook.reduce((n, g) => n + g.match.matched, 0) / inBook.length : null;
  return { games: recent.length, averageMatched, opp: recent.filter((g) => g.match.kind === 'opp').length };
}

/** 次に研究する所の 1 つ：「相手が研究にない手を指した局面」（外れた局面と相手の手の組） */
export interface NextSpot {
  /** 相手の手の後の局面のキーと自分の側 */
  key: string;
  side: Side;
  /** 何回その手を指されたか */
  count: number;
  /** いちばん最近の実戦（数え方と並びにも使う） */
  latest: MatchedGame;
}

/** 次に研究する所：回数の多い順、同じなら最近の順。古い実戦も数える（研究を足せばその行は自動で消える。持ち主の判断） */
export function nextSpots(list: readonly MatchedGame[]): NextSpot[] {
  const spots = new Map<string, NextSpot>();
  for (const g of list) {
    if (g.match.kind !== 'opp') continue;
    const after = studyPositions(g.game.moves.slice(0, g.match.matched + 1))[g.match.matched + 1];
    if (!after) continue;
    const key = `${g.game.mySide}|${sfenKey(after)}`;
    const spot = spots.get(key);
    if (!spot) spots.set(key, { key, side: g.game.mySide, count: 1, latest: g });
    else {
      spot.count += 1;
      if (gameTime(g.game) > gameTime(spot.latest.game)) spot.latest = g;
    }
  }
  return [...spots.values()].sort((a, b) => b.count - a.count || gameTime(b.latest.game) - gameTime(a.latest.game));
}
