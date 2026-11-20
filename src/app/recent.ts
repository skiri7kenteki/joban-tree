// トップ画面のための、端末だけの記録（段階7-1）：最近開いたツリー・グループの開閉。
// localStorage に置く（ツリーのデータには入れないので、開くたびに大きなツリーを保存し直さずに済み、書き出しにも入らない。持ち主の判断 2026-11-17）。
// 読めない・書けないとき（プライベートモードなど）も、画面は動くようにする。

import { signal } from '@preact/signals';
import { addRecent, type RecentEntry } from '../tree/organize';

const RECENT_KEY = 'joban-tree.recent';
const COLLAPSED_KEY = 'joban-tree.home-collapsed';

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
