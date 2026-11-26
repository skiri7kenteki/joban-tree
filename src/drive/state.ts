// 同期でこの端末が覚えておくこと（段階22-3）。localStorage に置く（バックアップには入れない）

import type { SyncState } from './sync';

const STATE_KEY = 'joban-tree.drive-sync';
const LAST_KEY = 'joban-tree.last-sync';
const NUDGE_KEY = 'joban-tree.sync-nudge-hidden-until';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 書けない端末では覚えない
  }
};
const time = (key: string): number | null => {
  const v = Number(read(key));
  return Number.isFinite(v) && v > 0 ? v : null;
};

/** 覚えていること。この端末の名前がまだ無ければ作る */
export function loadSyncState(): SyncState {
  try {
    const s = JSON.parse(read(STATE_KEY) ?? 'null') as Partial<SyncState> | null;
    if (s && typeof s.deviceId === 'string' && typeof s.seen === 'object' && s.seen !== null) {
      return { deviceId: s.deviceId, seen: s.seen, uploadedHash: typeof s.uploadedHash === 'string' ? s.uploadedHash : '' };
    }
  } catch {
    // 読めなければ作り直す（全部のファイルをもう一度読むだけ）
  }
  const state: SyncState = { deviceId: crypto.randomUUID(), seen: {}, uploadedHash: '' };
  saveSyncState(state);
  return state;
}

export function saveSyncState(state: SyncState): void {
  write(STATE_KEY, JSON.stringify(state));
}

/**
 * 合わせ済みの覚えを消す（バックアップから戻したとき）。次の同期で自分のファイルも読んでから送るので、
 * 戻した古いデータで、ドライブの中身を黙って上書きしない
 */
export function forgetSyncMemory(): void {
  if (read(STATE_KEY) !== null) saveSyncState({ ...loadSyncState(), seen: {}, uploadedHash: '' });
}

export const lastSyncAt = (): number | null => time(LAST_KEY);
export const markSynced = (at = Date.now()): void => write(LAST_KEY, String(at));
export const syncNudgeHiddenUntil = (): number | null => time(NUDGE_KEY);
export const hideSyncNudgeUntil = (at: number): void => write(NUDGE_KEY, String(at));
