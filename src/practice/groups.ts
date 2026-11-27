// 稽古のタブを定跡帳ごとにまとめる（段階26-1、持ち主の判断 2026-11-27）。ここは計算だけ。
//   - 定跡帳＝定跡帳のタブの 1 行と同じ「戦型のグループ × 自分の側」
//   - 定跡帳の中は手順の近い順（定跡帳の一覧・KIF の並びと同じ `bookOrder`）
//   - 行の文字は分かれ目を主に（自分で付けた名前はそのまま）

import { defaultNameMatch } from '../tree/bookEdit';
import { bookLabel, bookPool, studyGroupKey } from '../tree/organize';
import { STARTPOS_SFEN, applyUsiMove, moveText } from '../shogi/position';
import { bookOrder } from '../tree/studyBook';
import type { OpeningTemplate } from '../tree/templates';
import type { Study } from '../tree/types';
import { practiceStart, summarizePractice, type PracticeRecord } from './practice';

/** 見出しの定跡帳の名前（「横歩取り ☖後手」） */
export function practiceBookName(key: string): string {
  return bookLabel(key).replace(/（(先手|後手)番）$/, (_, side: string) => ` ${side === '先手' ? '☗' : '☖'}${side}`);
}

/** 2 本の手順の、初めから同じ手の数 */
function commonLength(a: readonly string[], b: readonly string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** 手順の from 番目と to 番目（0 始まり）の手の文字。行だけで分かるように「同」は使わない */
function textsAt(moves: readonly string[], from: number, to: number): [string, string] {
  let sfen = STARTPOS_SFEN;
  let first = '';
  for (let i = 0; i <= to; i++) {
    if (i === from) first = moveText(sfen, moves[i]);
    if (i === to) return [first, moveText(sfen, moves[i])];
    const next = applyUsiMove(sfen, moves[i]);
    if (!next) break;
    sfen = next.sfen;
  }
  return [first, ''];
}

/**
 * 分かれ目を主にした文字。分かれ目＝同じ定跡帳（pool）の中で、その手順だけになる最初の手（稽古を始める手より前にはしない）。
 * ほかの手順に丸ごと含まれる短い手順は「32手目 △３五歩 まで」
 */
export function forkLabel(study: Study, pool: readonly Study[], templates: readonly OpeningTemplate[]): string {
  const shared = Math.max(0, ...pool.filter((s) => s.id !== study.id).map((s) => commonLength(s.moves, study.moves)));
  const last = study.moves.length - 1;
  if (shared > last) {
    const [, end] = textsAt(study.moves, last, last);
    return `${last + 1}手目 ${end} まで`;
  }
  const fork = Math.min(last, Math.max(shared, practiceStart(study, templates)));
  const [first, end] = textsAt(study.moves, fork, last);
  return fork === last ? `${fork + 1}手目 ${first}まで` : `${fork + 1}手目 ${first} から ${end}まで`;
}

/** 稽古のタブの行と、稽古の画面の見出しの文字：自分で付けた名前はそのまま、自動の名前なら分かれ目 */
export function practiceRowLabel(study: Study, pool: readonly Study[], templates: readonly OpeningTemplate[]): string {
  return defaultNameMatch(study, templates) ? forkLabel(study, pool, templates) : study.name;
}

export interface PracticeGroup<T> {
  /** 定跡帳の key（`#/practice/group/<key>`） */
  key: string;
  name: string;
  /** その定跡帳の研究手順すべて */
  pool: Study[];
  /** 見出しの「身についた a／b本」（定跡帳の全部から） */
  learned: number;
  total: number;
  /** items の中でいちばん早い次の稽古の日（稽古の記録が無ければ undefined） */
  nextDue?: number;
  /** 手順の近い順 */
  items: T[];
}

/** 今日の稽古を指す順（段階26-2）：定跡帳ごとにまとめ、中は手順の近い順（稽古のタブの並びと同じ）。定跡帳の順は items（理由の優先の順）で最初に出る順 */
export function todayOrder<T extends { study: Study; record?: PracticeRecord }>(
  items: readonly T[],
  studies: readonly Study[],
  records: ReadonlyMap<string, PracticeRecord>,
  templates: readonly OpeningTemplate[],
): T[] {
  return groupPractice(items, studies, records, templates).flatMap((g) => g.items);
}

/** 今日の稽古・これからの稽古を定跡帳ごとにまとめる。定跡帳の順は items で最初に出る順 */
export function groupPractice<T extends { study: Study; record?: PracticeRecord }>(
  items: readonly T[],
  studies: readonly Study[],
  records: ReadonlyMap<string, PracticeRecord>,
  templates: readonly OpeningTemplate[],
): PracticeGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const key = studyGroupKey(item.study, templates);
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }
  return [...byKey].map(([key, list]) => {
    const pool = bookPool(key, studies, templates);
    const order = new Map(bookOrder(pool).map((s, i) => [s.id, i]));
    const { learned, total } = summarizePractice(pool, records, 0, templates);
    const due = list.flatMap((i) => i.record?.dueAt ?? []);
    return {
      key,
      name: practiceBookName(key),
      pool,
      learned,
      total,
      ...(due.length > 0 ? { nextDue: Math.min(...due) } : {}),
      items: [...list].sort((a, b) => order.get(a.study.id)! - order.get(b.study.id)!),
    };
  });
}
