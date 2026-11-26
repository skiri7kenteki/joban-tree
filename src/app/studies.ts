// 端末にある研究手順（段階8-1）を画面どうしで共有する。読み込みは最初に使うときに 1 回（あとは保存のたびに読み直す）。

import { signal } from '@preact/signals';
import { deleteStudy, listStudies, putStudies, writeStudies } from '../storage/studies';
import type { ImportRecord } from '../tree/bulkDelete';
import { findSameStudy, missingStudies } from '../tree/studies';
import type { Study } from '../tree/types';

/** トップ画面に一度だけ出す一言（KIF から取り込んだ後など） */
export const homeNotice = signal<string | null>(null);

/** KIF の取り込みの直後に、その取り込みを取り消せるようにする（一言と一緒に一度だけ渡す。段階25-2） */
export const importUndo = signal<(ImportRecord & { message: string; templateName?: string }) | null>(null);

/** まとめて消す（1 回の書き込みで。画面で確認を出してから呼ぶ）。onlyId は src/tree/deleted.ts の removalRecords */
export async function removeStudies(ids: readonly string[], opts: { onlyId?: boolean } = {}): Promise<void> {
  await writeStudies([], ids, opts);
  await refreshStudies();
}

/** 研究手順の一覧（読み込む前は null） */
export const library = signal<Study[] | null>(null);

let loading: Promise<Study[]> | null = null;

/** 読み直す */
export async function refreshStudies(): Promise<Study[]> {
  const list = await listStudies();
  library.value = list;
  return list;
}

/** まだ読んでいなければ読む */
export function ensureStudies(): Promise<Study[]> {
  if (library.value) return Promise.resolve(library.value);
  loading ??= refreshStudies().finally(() => {
    loading = null;
  });
  return loading;
}

/** 今の一覧（読む前は空） */
export function studiesNow(): Study[] {
  return library.value ?? [];
}

/** 保存する（同じ id なら上書き）して、一覧を読み直す */
export async function saveStudies(list: readonly Study[]): Promise<void> {
  await putStudies(list);
  await refreshStudies();
}

/** 名前・メモ（と自分の側）を直す */
export async function updateStudyFields(study: Study, f: { name: string; note: string; mySide?: Study['mySide'] }): Promise<Study> {
  const next: Study = { ...study, name: f.name.trim(), note: f.note.trimEnd(), mySide: f.mySide ?? study.mySide, updatedAt: Date.now() };
  await saveStudies([next]);
  return next;
}

/** まとめて保存・消す（定跡帳の書き込み。段階10-1）して、一覧を読み直す */
export async function applyStudyChange(change: { put: readonly Study[]; remove: readonly Pick<Study, 'id'>[] }): Promise<Study[]> {
  await writeStudies(change.put, change.remove.map((s) => s.id));
  return refreshStudies();
}

/** 消す（画面で確認を出してから呼ぶ） */
export async function removeStudy(id: string): Promise<void> {
  await deleteStudy(id);
  await refreshStudies();
}

/** 同じ手順の研究手順（読み込んでから探す） */
export async function findSame(moves: readonly string[]): Promise<Study | null> {
  return findSameStudy(await ensureStudies(), moves);
}

/**
 * 形式 6 までのツリーの JSON を取り込むとき：中の研究手順を独立した研究手順として取り込む（同じ手順がすでにあれば足さない）。
 * 取り込んだ数と、すでにあった数を返す
 */
export async function importLiftedStudies(lifted: readonly Study[]): Promise<{ added: number; skipped: number }> {
  const { added, skipped } = missingStudies(await ensureStudies(), lifted);
  if (added.length > 0) await saveStudies(added);
  return { added: added.length, skipped };
}

