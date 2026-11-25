// 局面メモと食い違いの知らせ（段階20-1、v0.44.0〜。持ち主の判断 2026-11-24「全ておすすめの通りで」）。ここは計算だけ
// （保存は src/storage/positions.ts、画面どうしの共有は src/app/positions.ts）。
//
// - 局面メモ：「局面（手数を除いた SFEN）× 自分の側」ごとに 1 つ。研究手順のメモとは別。手順前後で同じ局面に来ても同じメモが出る
// - 食い違い：**自分の手番の同じ局面で、研究手順によって自分の手が違う**こと（手順前後で同じ局面に来た場合も含む。自分の側が同じ研究手順だけを見る）
//   - 段階21-1 から：知らせるのは、研究の手のうち候補の表（src/tree/candidates.ts）に印の無い手があるときだけ。
//     「どちらを本命にするか」を選ぶと、全部に印が付いて消える。あとで別の手が増えたらまた知らせる
//   - 稽古では、ほかの研究手順の手を指してもまちがいにしない（`otherStudyAt`）
// - 局面メモと候補の表は同じ記録（IndexedDB の positions、DB の版 7。キーは `<側>|<局面のキー>`）

import { buildBookIndex, type BookIndex } from '../games/compare';
import { studyPositions } from '../review/studyReview';
import { sfenKey, sideToMove, type Side } from '../shogi/position';
import { candidatesProblem, tableOf, type Candidate } from './candidates';
import type { Study } from './types';

/** 1 つの局面の記録（局面メモと候補の表） */
export interface PositionNote {
  /** `<側>|<局面のキー>` */
  id: string;
  side: Side;
  /** 局面のキー（手数を除いた SFEN） */
  key: string;
  /** 局面メモ（空ならメモ無し） */
  note: string;
  /** 前の版の食い違いの「このままでよい」（USI）。次善として読み（`tableOf`）、次に表を書くときに candidates へ移す */
  okMoves?: string[];
  /** 自分の手の候補の表（段階21-1） */
  candidates?: Candidate[];
  updatedAt: number;
}

/** 局面メモの長さの上限 */
export const NOTE_MAX = 3000;

/** 局面の記録の id */
export function positionId(side: Side, sfen: string): string {
  return `${side}|${sfenKey(sfen)}`;
}

/** 食い違い 1 か所 */
export interface Conflict {
  /** 局面の記録の id */
  id: string;
  side: Side;
  /** その局面に来る、いちばん浅い研究手順と手数（定跡帳で開くとき・文に使う） */
  study: Study;
  ply: number;
  /** その局面の SFEN（手数つき） */
  sfen: string;
  /** 研究手順によって違う自分の手（研究手順の多い順） */
  moves: { move: string; studies: Study[] }[];
  /** 研究の手の全部に、候補の表の印がある（知らせない） */
  ok: boolean;
}

/** 研究の手の全部に印があるか */
function allMarked(rec: PositionNote | undefined, moves: Conflict['moves']): boolean {
  const table = tableOf(rec, moves);
  return moves.every((m) => table.some((c) => c.move === m.move));
}

/** 自分の側ごとの定跡帳の索引（局面で引く） */
export function bookIndexes(studies: readonly Study[]): Record<Side, BookIndex> {
  return { black: buildBookIndex(studies, 'black'), white: buildBookIndex(studies, 'white') };
}

/** その局面の研究の自分の手（手順前後も。研究手順の多い順） */
export function studyMovesAt(index: BookIndex, sfen: string): Conflict['moves'] {
  const entry = index.get(sfenKey(sfen));
  return entry ? [...entry.next].map(([move, studies]) => ({ move, studies })).sort((a, b) => b.studies.length - a.studies.length) : [];
}

/** 食い違いをすべて探す（浅い順） */
export function findConflicts(indexes: Record<Side, BookIndex>, records: ReadonlyMap<string, PositionNote>): Conflict[] {
  const list: Conflict[] = [];
  for (const side of ['black', 'white'] as const) {
    for (const [key, entry] of indexes[side]) {
      if (entry.next.size < 2) continue;
      const first = [...entry.through].sort((a, b) => a.ply - b.ply || b.study.updatedAt - a.study.updatedAt)[0];
      const sfen = studyPositions(first.study.moves.slice(0, first.ply))[first.ply];
      if (!sfen || sideToMove(sfen) !== side) continue;
      const moves = [...entry.next].map(([move, studies]) => ({ move, studies })).sort((a, b) => b.studies.length - a.studies.length);
      const id = `${side}|${key}`;
      list.push({ id, side, study: first.study, ply: first.ply, sfen, moves, ok: allMarked(records.get(id), moves) });
    }
  }
  return list.sort((a, b) => a.ply - b.ply || a.id.localeCompare(b.id));
}

/** その局面の食い違い（自分の手番で、研究手順によって自分の手が違うとき。無ければ null） */
export function conflictAt(index: BookIndex, side: Side, sfen: string, records: ReadonlyMap<string, PositionNote>): Conflict | null {
  if (sideToMove(sfen) !== side) return null;
  const key = sfenKey(sfen);
  const entry = index.get(key);
  if (!entry || entry.next.size < 2) return null;
  const first = [...entry.through].sort((a, b) => a.ply - b.ply)[0];
  const moves = studyMovesAt(index, sfen);
  const id = `${side}|${key}`;
  return { id, side, study: first.study, ply: first.ply, sfen, moves, ok: allMarked(records.get(id), moves) };
}

/**
 * 稽古で、正解でない手を指したとき：その手が、同じ局面（手順前後を含む）のほかの研究手順の自分の手なら、その研究手順（いちばん最近直したもの）。
 * まちがいにしないで「それは『X』の研究の手です」と出す
 */
export function otherStudyAt(index: BookIndex, sfen: string, move: string, exceptId: string): Study | null {
  const list = index.get(sfenKey(sfen))?.next.get(move)?.filter((s) => s.id !== exceptId) ?? [];
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

/** バックアップから読んだ 1 つの形を確かめる（おかしければ理由） */
export function positionProblem(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '形';
  const r = raw as Record<string, unknown>;
  if (r.side !== 'black' && r.side !== 'white') return '自分の側';
  if (typeof r.key !== 'string' || r.key.length === 0 || r.key.length > 200) return '局面';
  if (r.id !== `${r.side}|${r.key}`) return 'id';
  if (typeof r.note !== 'string' || r.note.length > NOTE_MAX) return 'メモ';
  if (r.okMoves !== undefined && (!Array.isArray(r.okMoves) || r.okMoves.length > 50 || !r.okMoves.every((m) => typeof m === 'string' && m.length <= 8))) return '手';
  if (r.candidates !== undefined) {
    const p = candidatesProblem(r.candidates);
    if (p) return `候補の表の${p}`;
  }
  if (typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt)) return '日時';
  return null;
}

/** 記録が空か（メモも候補の表も無ければ消す） */
export function isEmptyRecord(rec: Pick<PositionNote, 'note' | 'okMoves' | 'candidates'>): boolean {
  return rec.note.trim() === '' && !(rec.okMoves && rec.okMoves.length > 0) && !(rec.candidates && rec.candidates.length > 0);
}
