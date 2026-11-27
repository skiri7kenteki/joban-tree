// 早送りのための、この端末だけの覚え（段階26-2）。localStorage に置く。バックアップにも同期にも入れない。
//   - 今日 1 回目に正しく指した所（日が変わったら捨てる）
//   - 研究手順ごとの、前回の稽古でまちがえた手の番目
// 読めない・書けないとき（プライベートモードなど）も、開いている間は使える

import { startOfDay } from '../practice/practice';
import { parseToday, parseWrong, type WrongMemo } from '../practice/skip';

const TODAY_KEY = 'joban-tree.practice-today';
const WRONG_KEY = 'joban-tree.practice-wrong';

/** 書けなかったときの控え */
const fallback = new Map<string, unknown>();

function read(key: string): unknown {
  if (fallback.has(key)) return fallback.get(key);
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    fallback.delete(key);
  } catch {
    fallback.set(key, value);
  }
}

/** 今日 1 回目に正しく指した所の目印 */
export function correctToday(now = Date.now()): Set<string> {
  return parseToday(read(TODAY_KEY), now);
}

/** 1 回目の答えを覚える（正しければ足す。正しくなければ外す） */
export function rememberAnswer(key: string, ok: boolean, now = Date.now()): void {
  const keys = correctToday(now);
  if (ok === keys.has(key)) return;
  if (ok) keys.add(key);
  else keys.delete(key);
  write(TODAY_KEY, { day: startOfDay(now), keys: [...keys] });
}

export function wrongMemo(): WrongMemo {
  return parseWrong(read(WRONG_KEY));
}

/** 稽古を 1 本終えたときの、まちがえた手の番目（lastAt は稽古の記録と同じ日時） */
export function rememberWrong(studyId: string, lastAt: number, plies: number[]): void {
  const memo = wrongMemo();
  if (plies.length > 0) memo[studyId] = { lastAt, plies };
  else delete memo[studyId];
  write(WRONG_KEY, memo);
}
