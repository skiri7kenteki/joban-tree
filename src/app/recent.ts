// 一覧の画面のための、端末だけの記録：見出しの開閉（段階7-1）と、初めての 1 回だけの説明。
// localStorage に置く。読めない・書けないとき（プライベートモードなど）も、画面は動くようにする。

import { signal } from '@preact/signals';

const COLLAPSED_KEY = 'joban-tree.home-collapsed';
const HINTS_KEY = 'joban-tree.hints-seen';

function read<T>(key: string, fallback: T, check: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v: unknown = JSON.parse(raw);
    return check(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても、開いている間は使える
  }
}

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

const hasStorage = typeof localStorage !== 'undefined';

/** 初めの形から変えた見出しの key。ふつうは「閉じている」（初めは開いている）。稽古の「これから」（practice-later:）だけは「開いている」（初めは閉じている。段階26-1） */
export const collapsedGroups = signal<string[]>(hasStorage ? read(COLLAPSED_KEY, [], isStrings) : []);

export function toggleGroup(key: string): void {
  const now = collapsedGroups.value;
  collapsedGroups.value = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
  write(COLLAPSED_KEY, collapsedGroups.value);
}

/**
 * 初めての 1 回だけ出す説明（段階11-3）。
 * answer-tap：稽古の「盤を指して答えます」、book-write：定跡帳の「盤で指すと、その場で研究手順に足されます」
 */
export type HintId = 'answer-tap' | 'book-write';

let seenHints: string[] | null = null;

/** まだ見ていない説明なら true を返し、見たことを端末に覚える */
export function takeHint(id: HintId): boolean {
  if (!hasStorage) return false;
  seenHints ??= read(HINTS_KEY, [], isStrings);
  if (seenHints.includes(id)) return false;
  seenHints = [...seenHints, id];
  write(HINTS_KEY, seenHints);
  return true;
}
