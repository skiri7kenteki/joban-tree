// 段階25-1：戦型を選ぶ・作る（変化付き KIF の取り込みと、定跡帳の ⋯）で使う計算。画面は src/app/ImportTemplate.tsx

import type { Side } from '../shogi/position';
import { groupStudies, studyGroupKey, type StudyItem } from './organize';
import { startsWith } from './studies';
import { closestTemplate, templateLine, type OpeningTemplate } from './templates';

/** 取り込む手順が全部、その戦型の手順で始まる（その戦型を選べる） */
export function passesAll(template: Pick<OpeningTemplate, 'moves'>, lines: readonly (readonly string[])[]): boolean {
  return lines.every((l) => startsWith(l, template.moves));
}

/** 自動で決まる戦型：全部が通る・自分の側が同じ・いちばん長いもの（無ければ null） */
export function autoTemplate(lines: readonly (readonly string[])[], side: Side, templates: readonly OpeningTemplate[]): OpeningTemplate | null {
  if (lines.length === 0) return null;
  return closestTemplate(
    templates.filter((t) => t.mySide === side && passesAll(t, lines)),
    lines[0],
  );
}

export interface StartRange {
  /** 出発点の初期値（何手目の局面か） */
  initial: number;
  /** ‹ › で進められるいちばん先（全部が通る局面） */
  max: number;
  /** これより先を出発点にすると、出発点より後に自分の手が残らない手順がある */
  limit: number;
}

/** その手順で、自分が最後に指す手が何番目か（0 始まり。自分の手が無ければ -1） */
function lastOwnIndex(line: readonly string[], side: Side): number {
  const mine = side === 'black' ? 0 : 1;
  for (let i = line.length - 1; i >= 0; i--) if (i % 2 === mine) return i;
  return -1;
}

/** 出発点（ply 手目の局面）より後に、自分の手が無い手順があるか */
export function lacksOwnAfter(lines: readonly (readonly string[])[], side: Side, ply: number): boolean {
  return lines.some((l) => lastOwnIndex(l, side) < ply);
}

/**
 * 新しい戦型の出発点の範囲。出発点は初期局面より後で、全部の手順が通る局面。
 * 初期値は、どの手順にも出発点より後に自分の手が 1 手以上残る所（定跡帳で戻れなくなる・稽古が初手からになるのを防ぐ。持ち主の判断 2026-11-26）。
 * 初手が違う・手順が無いときは null（作れない）
 */
export function startRange(lines: readonly (readonly string[])[], side: Side): StartRange | null {
  if (lines.length === 0) return null;
  let max = 0;
  while (lines.every((l) => max < l.length && l[max] === lines[0][max])) max++;
  if (max === 0) return null;
  const own = Math.min(...lines.map((l) => lastOwnIndex(l, side)));
  const limit = Math.max(1, Math.min(max, own));
  return { initial: limit, max, limit };
}

/** 新しい戦型の名前の初期値（「12手目 △４二銀まで」。ツリーの画面の登録と同じ形） */
export function startName(moves: readonly string[]): string {
  const r = templateLine(moves);
  if (moves.length === 0 || !r.ok) return '';
  return `${moves.length}手目 ${r.line[r.line.length - 1].text ?? ''}まで`;
}

/** 研究手順が入る、一覧のグループと本数（一覧の並びの順） */
export function destinations(studies: readonly StudyItem[], templates: readonly OpeningTemplate[]): { key: string; label: string; count: number }[] {
  return groupStudies(studies, templates).map((g) => ({ key: g.key, label: g.label, count: g.items.length }));
}

/** 戦型 added を足すと、一覧のグループが変わる研究手順 */
export function movedStudies<S extends StudyItem>(studies: readonly S[], templates: readonly OpeningTemplate[], added: OpeningTemplate): S[] {
  const after = [...templates, added];
  return studies.filter((s) => studyGroupKey(s, templates) !== studyGroupKey(s, after));
}
