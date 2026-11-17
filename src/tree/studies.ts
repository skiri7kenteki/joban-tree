// 研究手順（段階7-2）：ツリーの中の気になる手順に、名前とメモを付けてしおりのように保存する。
// ツリーの中に保存する（TreeData.studies、形式 6）ので、ツリーを JSON で渡すと研究手順とメモも一緒に届く。
// 手順は「ツリーの開始局面からの指し手（USI）の並び」。ツリーにある手（edges）だけでたどる。
// 後で手を除外した・消したなどでたどれなくなっても、研究手順は消さない（「途中までしかたどれません」と出す）。

import { applyUsiMove, moveText } from '../shogi/position';
import { lastPrefixMove } from './browse';
import type { Study, TreeData } from './types';

export type { Study } from './types';

/** 新しい研究手順の id */
export function newStudyId(): string {
  return `s-${crypto.randomUUID()}`;
}

/** 開始局面からのキーの並び（閲覧画面の path）を、指し手の並びにする */
export function movesOfPath(tree: TreeData, path: readonly string[]): string[] {
  const moves: string[] = [];
  for (let i = 1; i < path.length; i++) {
    const edge = tree.nodes[path[i - 1]]?.edges.find((e) => e.to === path[i]);
    if (!edge) break;
    moves.push(edge.move);
  }
  return moves;
}

export interface StudyTrace {
  /** たどれた局面のキー（開始局面から。閲覧画面の path にそのまま使える） */
  keys: string[];
  /** たどれた手の数 */
  reached: number;
  /** 最後までたどれたか */
  complete: boolean;
}

/** 研究手順をツリーの手（除外した手は使わない）でたどる */
export function traceStudy(tree: TreeData, moves: readonly string[]): StudyTrace {
  const keys = [tree.rootKey];
  for (const move of moves) {
    const node = tree.nodes[keys[keys.length - 1]];
    const edge = node?.edges.find((e) => e.move === move);
    if (!edge || !tree.nodes[edge.to]) break;
    keys.push(edge.to);
  }
  return { keys, reached: keys.length - 1, complete: keys.length - 1 === moves.length };
}

const sameMoves = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((m, i) => m === b[i]);

/** 同じ手順の研究手順（あれば） */
export function findSameStudy(tree: TreeData, moves: readonly string[]): Study | null {
  return (tree.studies ?? []).find((s) => sameMoves(s.moves, moves)) ?? null;
}

/** 名前とメモを確かめる。問題が無ければ null */
export function checkStudyFields(f: { name: string; note: string }): string | null {
  if (f.name.trim() === '') return '名前を入れてください。';
  if (f.name.trim().length > 100) return '名前は 100 文字までです。';
  if (f.note.length > 3000) return 'メモは 3000 文字までです。';
  return null;
}

/**
 * 研究手順を足す。同じ手順がすでにあれば、足さずにそれを返す（created: false）。
 * 手順はツリーにある手だけ（最後までたどれないものは足さない。null）
 */
export function addStudy(
  tree: TreeData,
  f: { name: string; note: string; moves: readonly string[] },
  now: number,
  id: string = newStudyId(),
): { study: Study; created: boolean } | null {
  const same = findSameStudy(tree, f.moves);
  if (same) return { study: same, created: false };
  if (f.moves.length === 0 || !traceStudy(tree, f.moves).complete) return null;
  const study: Study = { id, name: f.name.trim(), note: f.note.trimEnd(), moves: [...f.moves], createdAt: now, updatedAt: now };
  tree.studies = [...(tree.studies ?? []), study];
  return { study, created: true };
}

/** 名前とメモを直す */
export function updateStudy(tree: TreeData, id: string, f: { name: string; note: string }, now: number): boolean {
  const study = tree.studies?.find((s) => s.id === id);
  if (!study) return false;
  study.name = f.name.trim();
  study.note = f.note.trimEnd();
  study.updatedAt = now;
  return true;
}

/** 消す（画面で確認を出してから呼ぶ） */
export function removeStudy(tree: TreeData, id: string): boolean {
  const before = tree.studies?.length ?? 0;
  tree.studies = (tree.studies ?? []).filter((s) => s.id !== id);
  return tree.studies.length < before;
}

/** 名前の初期値：最後の 3 手（例：「▲３六飛 △８四飛 ▲２六飛」）。手が無ければツリーの名前 */
export function defaultStudyName(tree: TreeData, moves: readonly string[], count = 3): string {
  if (moves.length === 0) return tree.name;
  const texts: string[] = [];
  let sfen = tree.nodes[tree.rootKey].sfen;
  let prev = lastPrefixMove(tree);
  for (const move of moves) {
    texts.push(moveText(sfen, move, prev));
    const next = applyUsiMove(sfen, move);
    if (!next) break;
    sfen = next.sfen;
    prev = move;
  }
  return texts.slice(-count).join(' ');
}

/**
 * 今たどってきた手順（開始局面から）が、研究手順の途中なら、その研究手順の次の手（★を付ける手）。
 * 合流（別の手順から同じ局面に来た）では付けない（持ち主の判断 2026-11-17）
 */
export function studyNextMoves(tree: TreeData, pathMoves: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const s of tree.studies ?? []) {
    if (s.moves.length > pathMoves.length && pathMoves.every((m, i) => s.moves[i] === m)) out.add(s.moves[pathMoves.length]);
  }
  return out;
}

/** 今の局面で終わる研究手順（同じ手順は 1 つだけなので、あれば 1 つ） */
export function studyEndingAt(tree: TreeData, pathMoves: readonly string[]): Study | null {
  return findSameStudy(tree, pathMoves);
}

/** メモの最初の 1 行（一覧用） */
export function firstLine(note: string): string {
  return note.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? '';
}

/**
 * 用意済みのツリーの新しい版に、前の版のコピーの研究手順を引き継ぐ見通し（段階7-2）。
 * 新しい版のツリーで最後までたどれるものだけ引き継げる。たどれないものは数と名前を知らせる（前の版のコピーには残る）
 */
export function carryStudies(from: readonly Study[], to: TreeData): { carried: Study[]; lost: Study[] } {
  const carried: Study[] = [];
  const lost: Study[] = [];
  for (const s of from) {
    if (traceStudy(to, s.moves).complete) carried.push({ ...s, moves: [...s.moves] });
    else lost.push(s);
  }
  return { carried, lost };
}
