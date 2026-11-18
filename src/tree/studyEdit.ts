// 研究手順の手順を編集する（段階9-1、持ち主の判断 2026-11-18「おすすめの通りで」）。画面は src/app/StudyScreen.tsx、編集中の状態は src/app/studyEdit.ts。
// ここは画面から切り離した計算だけ（Vitest で確かめる）。
//   - 下書き（Draft）：編集中の手順と、盤に出している局面（平手から何手目か）、取り消し用の前の状態
//   - 終わりの局面で指す → 手順の最後に足す。途中の局面で次の手と同じ手 → 1 手進むだけ。違う手 → 画面で選んでもらう（置き換える／別の研究手順にする）
//   - ここで終わりにする → 今の局面より後ろの手を消す
//   - 1 手戻す → 最後の操作（足す・置き換える・終わりにする）を 1 つずつ取り消す
//   - 保存するとき：手が 0 本は保存できない、ほかの研究手順とまったく同じ手順なら知らせる、戦型は付け直す、名前は初期値のままなら付け直す

import { closestTemplate, type OpeningTemplate } from './templates';
import { defaultStudyName, findSameStudy, sameMoves } from './studies';
import type { Study } from './types';

/** 取り消し用に覚えておく、操作の前の状態 */
export interface DraftSnapshot {
  moves: string[];
  index: number;
}

/** 編集中の手順 */
export interface Draft {
  /** 平手からの手順（USI） */
  moves: string[];
  /** 盤に出している局面（平手から何手目か。0〜moves.length） */
  index: number;
  /** 1 手戻す用（古い順） */
  undo: DraftSnapshot[];
}

/** 編集を始める（index は今見ている局面） */
export function startDraft(moves: readonly string[], index: number): Draft {
  return { moves: [...moves], index: Math.max(0, Math.min(moves.length, index)), undo: [] };
}

/** 局面を移る（編集ではないので取り消しの対象にしない） */
export function moveDraftTo(draft: Draft, index: number): Draft {
  return { ...draft, index: Math.max(0, Math.min(draft.moves.length, index)) };
}

const snapshot = (draft: Draft): DraftSnapshot => ({ moves: [...draft.moves], index: draft.index });

/**
 * 盤で指したとき：
 *   - 終わりの局面なら手順の最後に足す（kind: 'append'）
 *   - 次の手と同じなら 1 手進むだけ（kind: 'advance'）
 *   - 次の手と違うなら、どうするか画面で選んでもらう（kind: 'fork'。下書きは変えない）
 */
export function playOnDraft(draft: Draft, move: string): { kind: 'append' | 'advance'; draft: Draft } | { kind: 'fork'; next: string } {
  const next = draft.moves[draft.index];
  if (next === undefined) {
    return { kind: 'append', draft: { moves: [...draft.moves, move], index: draft.index + 1, undo: [...draft.undo, snapshot(draft)] } };
  }
  if (next === move) return { kind: 'advance', draft: { ...draft, index: draft.index + 1 } };
  return { kind: 'fork', next };
}

/** 「ここから先を置き換える」：今の局面より後ろの手を消して、指した手から続ける */
export function replaceFrom(draft: Draft, move: string): Draft {
  return { moves: [...draft.moves.slice(0, draft.index), move], index: draft.index + 1, undo: [...draft.undo, snapshot(draft)] };
}

/** 「ここで終わりにする」で消える手の数 */
export function movesAfter(draft: Draft): number {
  return draft.moves.length - draft.index;
}

/** 「ここで終わりにする」：今の局面より後ろの手を消す（初期局面では使えない＝手が 0 本になるので、そのままを返す） */
export function truncateHere(draft: Draft): Draft {
  if (draft.index === 0 || movesAfter(draft) === 0) return draft;
  return { moves: draft.moves.slice(0, draft.index), index: draft.index, undo: [...draft.undo, snapshot(draft)] };
}

/** 「1 手戻す」：最後の操作を取り消す（局面もその操作の前に戻す） */
export function undoDraft(draft: Draft): Draft {
  const prev = draft.undo[draft.undo.length - 1];
  if (!prev) return draft;
  return { moves: [...prev.moves], index: prev.index, undo: draft.undo.slice(0, -1) };
}

/** 保存していない変更があるか */
export function draftChanged(draft: Pick<Draft, 'moves'>, saved: readonly string[]): boolean {
  return !sameMoves(draft.moves, saved);
}

/** 保存できるか：手が 0 本（'empty'）、ほかの研究手順とまったく同じ手順（'same'）なら保存できない */
export function checkEdited<S extends Pick<Study, 'id' | 'moves'>>(
  moves: readonly string[],
  studies: readonly S[],
  selfId: string | null,
): { kind: 'empty' } | { kind: 'same'; other: S } | null {
  if (moves.length === 0) return { kind: 'empty' };
  const other = findSameStudy(
    studies.filter((s) => s.id !== selfId),
    moves,
  );
  return other ? { kind: 'same', other } : null;
}

/** 手順から付け直す戦型（いちばん長く一致する戦型。無ければ付けない） */
export function templateIdFor(moves: readonly string[], templates: readonly OpeningTemplate[]): string | undefined {
  return closestTemplate(templates, moves)?.id;
}

/**
 * 編集した手順で保存する研究手順。
 *   - 戦型は手順から付け直す（手順が変わったときだけ）
 *   - 名前は、元の手順の初期値のままなら、新しい手順の初期値に付け直す（自分で付けた名前は変えない）。
 *     branchAt：この編集が「分かれる手」で作った研究手順の続きなら、その手（0 始まり）。名前に分かれ目を入れたままにする
 *   - メモ・自分の側・作った日時はそのまま
 */
export function editedStudy(
  original: Study,
  moves: readonly string[],
  templates: readonly OpeningTemplate[],
  now: number,
  branchAt?: number,
): Study {
  if (sameMoves(original.moves, moves)) return original;
  const templateId = templateIdFor(moves, templates);
  const shape = { moves: [...moves], ...(templateId ? { templateId } : {}) };
  const wasDefault =
    original.name === defaultStudyName(original, templates) ||
    (branchAt !== undefined && original.name === defaultStudyName(original, templates, branchAt));
  const name = wasDefault ? defaultStudyName(shape, templates, branchAt) : original.name;
  const { templateId: _old, ...rest } = original;
  void _old;
  return { ...rest, ...shape, name, updatedAt: now };
}

/** 「分かれる手として、別の研究手順にする」：今の局面までの手順＋指した手 */
export function branchMoves(draft: Draft, move: string): string[] {
  return [...draft.moves.slice(0, draft.index), move];
}

/**
 * 分かれる手で作る新しい研究手順：名前は分かれ目の手がわかる形（段階8と同じ決まり）、メモは空、
 * 自分の側は元の研究手順から。戦型は元の研究手順の戦型が今の手順にも当てはまればそれ、無ければ手順から付け直す
 */
export function branchStudy(
  original: Pick<Study, 'mySide' | 'templateId'>,
  moves: readonly string[],
  templates: readonly OpeningTemplate[],
  now: number,
  id: string,
): Study {
  const kept = original.templateId && templates.some((t) => t.id === original.templateId && t.moves.length <= moves.length && t.moves.every((m, i) => moves[i] === m));
  const templateId = kept ? original.templateId : templateIdFor(moves, templates);
  const shape = { moves: [...moves], ...(templateId ? { templateId } : {}) };
  return {
    id,
    name: defaultStudyName(shape, templates, moves.length - 1),
    note: '',
    ...shape,
    mySide: original.mySide,
    createdAt: now,
    updatedAt: now,
  };
}
