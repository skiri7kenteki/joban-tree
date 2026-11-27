// 同じ出だしの早送り（段階26-2、持ち主の判断 2026-11-27）。ここは計算だけ（端末への保存は src/app/practiceMemory.ts）。
//   - 分かれ目＝今日まだ 1 回目に正しく指していない、最初の自分の手。**その 1 つ前の自分の手**から自分で指す
//   - 同じ出だし＝初手からの手順が同じ（自分の側も同じ。手順前後は別）
//   - 前回まちがえた手があれば、そこより前から。どの手か分からなければ早送りしない
// 稽古の記録（PracticeRecord）の形は変えない。今日正しく指した所と、前回まちがえた手の番目は、この端末だけに別に覚える

import type { Study } from '../tree/types';
import { startOfDay, type PracticeRecord } from './practice';

/** 短い目印にする（長い手順をそのまま覚えると大きくなるので） */
function hash(text: string, seed: number): string {
  let h = seed;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** 研究手順の ply 番目（0 始まり）の自分の手を表す目印：自分の側と、初手からその手までの手順 */
export function answerKey(study: Pick<Study, 'moves' | 'mySide'>, ply: number): string {
  const text = `${study.mySide}|${study.moves.slice(0, ply + 1).join(' ')}`;
  return `${ply}.${hash(text, 0x811c9dc5)}.${hash(text, 0x01234567)}`;
}

/**
 * 自分で指し始める番目（0 始まり）。start なら早送りしない。
 * plies：自分の手の番目（稽古する順）、start：稽古を始める番目、correct：今日 1 回目に正しく指した目印、
 * wrong：前回の稽古でまちがえた番目（分からなければ null）
 */
export function skipStart(
  study: Pick<Study, 'moves' | 'mySide'>,
  plies: readonly number[],
  start: number,
  correct: ReadonlySet<string>,
  wrong: readonly number[] | null,
): number {
  if (wrong === null) return start;
  const first = plies.findIndex((p) => wrong.includes(p) || !correct.has(answerKey(study, p)));
  // どれも当てはまらない（全部が今日指した所に含まれる）ときも、最後の自分の手は指す
  const stop = first < 0 ? plies.length : first;
  return stop === 0 ? start : plies[stop - 1];
}

/** 前回まちがえた手の覚え（研究手順の id → どの稽古の、何番目か） */
export type WrongMemo = Record<string, { lastAt: number; plies: number[] }>;

/** 前回の稽古でまちがえた番目。まちがえていなければ空、どの手か分からなければ null（更新前の記録・ほかの端末で稽古した記録） */
export function wrongPliesOf(record: PracticeRecord | undefined, memo: WrongMemo): number[] | null {
  if (!record || record.lastMistakes === 0) return [];
  const m = memo[record.studyId];
  return m && m.lastAt === record.lastAt && m.plies.length === record.lastMistakes ? m.plies : null;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 保存されていた前回まちがえた手（形のおかしいものは捨てる） */
export function parseWrong(raw: unknown): WrongMemo {
  if (!isObject(raw)) return {};
  const out: WrongMemo = {};
  for (const [id, v] of Object.entries(raw)) {
    if (isObject(v) && isNumber(v.lastAt) && Array.isArray(v.plies) && v.plies.every(isNumber)) out[id] = { lastAt: v.lastAt, plies: v.plies };
  }
  return out;
}

/** 保存されていた「今日正しく指した目印」。今日のものでなければ空 */
export function parseToday(raw: unknown, now: number): Set<string> {
  if (!isObject(raw) || raw.day !== startOfDay(now) || !Array.isArray(raw.keys)) return new Set();
  return new Set(raw.keys.filter((k): k is string => typeof k === 'string'));
}
