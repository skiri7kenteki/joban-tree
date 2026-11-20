// トップ画面のための、端末だけの記録（段階7-1）：最近開いたツリー・グループの開閉。
// localStorage に置く（ツリーのデータには入れないので、開くたびに大きなツリーを保存し直さずに済み、書き出しにも入らない。持ち主の判断 2026-11-17）。
// 読めない・書けないとき（プライベートモードなど）も、画面は動くようにする。

import { signal } from '@preact/signals';
import { addRecent, type RecentEntry } from '../tree/organize';

const RECENT_KEY = 'joban-tree.recent';
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

const isRecent = (v: unknown): v is RecentEntry[] =>
  Array.isArray(v) && v.every((r) => typeof r === 'object' && r !== null && typeof (r as RecentEntry).id === 'string' && typeof (r as RecentEntry).at === 'number');
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string');

const hasStorage = typeof localStorage !== 'undefined';

/** 最近開いたツリー（新しい順） */
export const recentOpened = signal<RecentEntry[]>(hasStorage ? read(RECENT_KEY, [], isRecent) : []);

/** ツリーを開いたことを記録する */
export function markOpened(id: string, at: number = Date.now()): void {
  recentOpened.value = addRecent(recentOpened.value, id, at);
  write(RECENT_KEY, recentOpened.value);
}

/** 消したツリーを記録から外す */
export function forgetOpened(id: string): void {
  recentOpened.value = recentOpened.value.filter((r) => r.id !== id);
  write(RECENT_KEY, recentOpened.value);
}

/** 閉じているグループの key（初めては全部開いている） */
export const collapsedGroups = signal<string[]>(hasStorage ? read(COLLAPSED_KEY, [], isStrings) : []);

// トップ画面の「ツリー｜研究手順」の切り替え（段階7-2、端末に覚えていた）は、段階11-1 で画面の下のタブ（URL で分かる）にしたのでやめた

export function toggleGroup(key: string): void {
  const now = collapsedGroups.value;
  collapsedGroups.value = now.includes(key) ? now.filter((k) => k !== key) : [...now, key];
  write(COLLAPSED_KEY, collapsedGroups.value);
}

/**
 * 初めての 1 回だけ出す説明（段階11-3）。
 * board-tap：新しいツリーの「盤の駒をタップ → 行き先をタップで指せます」、answer-tap：復習の「… で答えます」、
 * book-write：定跡帳の「盤で指すと、その場で研究手順に足されます」、tree-main：ツリーの手の ⋯ の「本線が復習の正解…になります」
 */
export type HintId = 'board-tap' | 'answer-tap' | 'book-write' | 'tree-main';

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
