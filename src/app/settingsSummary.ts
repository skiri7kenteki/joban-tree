// 設定のタブの行の右に小さく出す「今の値」の文字。

import { EVALS, type EvalId } from '../engine/config';

/** 月/日（11/27） */
function monthDay(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function skipSameSummary(skip: boolean): string {
  return skip ? '早送り する' : '早送り しない';
}

export function warsNameSummary(name: string): string {
  return name.trim() || '未設定';
}

export function lastBackupSummary(at: number | null): string {
  return at ? `バックアップ ${monthDay(at)}` : '未バックアップ';
}

export function lastSyncSummary(at: number | null): string {
  if (!at) return '未同期';
  const d = new Date(at);
  return `${monthDay(at)} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function evalSummary(id: EvalId): string {
  return EVALS[id].label;
}
