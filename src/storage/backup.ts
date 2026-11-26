// まとめてのバックアップの、保存場所の読み書き（段階17、v0.41.0〜）。ファイルの形と確かめ方は src/tree/backupFile.ts。
// - 読む：研究手順・ツリー・復習の記録・自分で登録した戦型・実戦の棋譜（段階18）・稽古の記録（段階19）・局面メモ（段階20-1）を 1 つのトランザクションでまとめて読み、端末の設定（localStorage）を足す
// - 戻す：今のデータを全部置きかえる（7 つの保存場所を空にして書く。全部やり切るか、何もしないか）。
//   **戻す前に、今のデータを端末の中に取っておく**（別の小さな保存場所 joban-tree-before-restore に最新の 1 回分だけ。
//   今の保存場所の形は変えない。設定の［戻す前のデータに戻す］で元に戻せる。持ち主の判断 2026-11-23）
// - 最後にバックアップした日・すすめを閉じた日は localStorage

import { PREF_KEYS, makeBackup, type BackupData, type BackupFile } from '../tree/backupFile';
import type { ReviewRecord } from '../review/review';
import type { Study, TreeData } from '../tree/types';
import type { StoredTemplate } from './templates';
import type { Game } from '../games/game';
import type { PracticeRecord } from '../practice/practice';
import type { PositionNote } from '../tree/positions';
import { reviveForRestore, unionDeleted } from '../tree/deleted';
import { changesNothing, mergeBackups } from '../tree/merge';
import { GAMES, POSITIONS, PRACTICE, REVIEW, STUDIES, TEMPLATES, TREES, done, finished, openDb } from './db';
import { readDeleted, writeDeleted } from './deleted';

const LAST_BACKUP_KEY = 'joban-tree.last-backup';
const NUDGE_HIDDEN_KEY = 'joban-tree.backup-nudge-hidden-until';

/** 今のデータを全部読む */
export async function readAllData(): Promise<BackupData> {
  const db = await openDb();
  const tx = db.transaction([STUDIES, TREES, REVIEW, TEMPLATES, GAMES, PRACTICE, POSITIONS]);
  const [studies, trees, reviews, templates, games, practice, positions] = await Promise.all([
    done(tx.objectStore(STUDIES).getAll()) as Promise<Study[]>,
    done(tx.objectStore(TREES).getAll()) as Promise<TreeData[]>,
    done(tx.objectStore(REVIEW).getAll()) as Promise<ReviewRecord[]>,
    done(tx.objectStore(TEMPLATES).getAll()) as Promise<StoredTemplate[]>,
    done(tx.objectStore(GAMES).getAll()) as Promise<Game[]>,
    done(tx.objectStore(PRACTICE).getAll()) as Promise<PracticeRecord[]>,
    done(tx.objectStore(POSITIONS).getAll()) as Promise<PositionNote[]>,
  ]);
  const prefs: Record<string, string> = {};
  for (const k of PREF_KEYS) {
    const v = readLocal(k);
    if (v !== null) prefs[k] = v;
  }
  return { studies, trees, reviews, templates, games, practice, positions, deleted: readDeleted(), prefs };
}

/** 今のデータのバックアップ（ファイルの中身） */
export async function currentBackup(appVersion: string, now = Date.now()): Promise<BackupFile> {
  return makeBackup(await readAllData(), now, appVersion);
}

/** データを全部置きかえる（7 つの保存場所を空にして書き、端末の設定も入れ替える） */
export async function writeAllData(data: BackupData): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([STUDIES, TREES, REVIEW, TEMPLATES, GAMES, PRACTICE, POSITIONS], 'readwrite');
  const put = (name: string, list: readonly unknown[]) => {
    const store = tx.objectStore(name);
    store.clear();
    for (const item of list) store.put(item);
  };
  put(STUDIES, data.studies);
  put(TREES, data.trees);
  put(REVIEW, data.reviews);
  put(TEMPLATES, data.templates);
  // 段階17 の版で取っておいた「戻す前のデータ」には games が無い（実戦は空にする）
  put(GAMES, data.games ?? []);
  put(PRACTICE, data.practice ?? []);
  put(POSITIONS, data.positions ?? []);
  await finished(tx);
  writeDeleted(data.deleted ?? []);
  for (const k of PREF_KEYS) {
    if (k in data.prefs) writeLocal(k, data.prefs[k]);
    else removeLocal(k);
  }
}

/**
 * バックアップから戻す：今のデータを端末の中に取っておいてから、全部置きかえる。
 * 消した記録のあるものを戻すときは、戻した日時を付ける（次に合わせたときに、また消されないように。段階22-2）
 */
export async function restoreFromBackup(data: BackupData, appVersion: string): Promise<void> {
  const current = await currentBackup(appVersion);
  await saveSnapshot(current);
  await writeAllData(reviveForRestore(data, unionDeleted(current.data.deleted, data.deleted ?? []), Date.now()));
}

/**
 * ほかの端末のバックアップを合わせる（段階22-2）：今のデータを端末の中に取っておいてから、合わせた結果を書く。
 * 確認の窓を出している間に変わったかもしれないので、ここでもう一度合わせる
 */
export async function mergeFromBackup(incoming: BackupData, appVersion: string): Promise<void> {
  const current = await currentBackup(appVersion);
  const result = mergeBackups(current.data, incoming);
  // 中身が変わらないときは、取っておいた「戻す前のデータ」を上書きしない（同じファイルをもう一度合わせても、前に戻せるように）
  if (!changesNothing(result)) await saveSnapshot(current);
  await writeAllData(result.data);
}

// ---- 戻す前のデータ（端末の中に最新の 1 回分） ----

const SNAPSHOT_DB = 'joban-tree-before-restore';
const SNAPSHOT_STORE = 'snapshots';
const SNAPSHOT_KEY = 'last';

function openSnapshotDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SNAPSHOT_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(SNAPSHOT_STORE)) request.result.createObjectStore(SNAPSHOT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('戻す前のデータの保存場所を開けませんでした'));
  });
}

export async function saveSnapshot(file: BackupFile): Promise<void> {
  const db = await openSnapshotDb();
  try {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(SNAPSHOT_STORE).put(file, SNAPSHOT_KEY);
    await finished(tx);
  } finally {
    db.close();
  }
}

/** 戻す前のデータ（無ければ null） */
export async function loadSnapshot(): Promise<BackupFile | null> {
  const db = await openSnapshotDb();
  try {
    return ((await done(db.transaction(SNAPSHOT_STORE).objectStore(SNAPSHOT_STORE).get(SNAPSHOT_KEY))) as BackupFile | undefined) ?? null;
  } finally {
    db.close();
  }
}

// ---- 最後にバックアップした日・すすめを閉じた日 ----

export function lastBackupAt(): number | null {
  const v = Number(readLocal(LAST_BACKUP_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function markBackedUp(at = Date.now()): void {
  writeLocal(LAST_BACKUP_KEY, String(at));
}

export function nudgeHiddenUntilStored(): number | null {
  const v = Number(readLocal(NUDGE_HIDDEN_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function hideNudgeUntil(at: number): void {
  writeLocal(NUDGE_HIDDEN_KEY, String(at));
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 書けない端末（プライベートブラウズなど）では覚えない
  }
}

function removeLocal(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 同上
  }
}
