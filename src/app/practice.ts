// 稽古の記録（段階19）を画面どうしで共有する。読み込みは最初に使うときに 1 回（あとは保存のたびに読み直す）。
// 今日の稽古の計算に使う「実戦で違う手を指した研究手順」は、実戦の棋譜から毎回計算する（段階18 の照らし合わせ）。

import { signal } from '@preact/signals';
import { matchGames, missedStudies } from '../games/compare';
import type { Game } from '../games/game';
import { practicePlan, type PracticeRecord } from '../practice/practice';
import { listPractice, putPractice } from '../storage/practice';
import type { OpeningTemplate } from '../tree/templates';
import type { Study } from '../tree/types';

/** 研究手順の id → 稽古の記録（読み込む前は null） */
export const practiceRecords = signal<Map<string, PracticeRecord> | null>(null);

let loading: Promise<Map<string, PracticeRecord>> | null = null;

export async function refreshPractice(): Promise<Map<string, PracticeRecord>> {
  const map = new Map((await listPractice()).map((r) => [r.studyId, r]));
  practiceRecords.value = map;
  return map;
}

export function ensurePractice(): Promise<Map<string, PracticeRecord>> {
  if (practiceRecords.value) return Promise.resolve(practiceRecords.value);
  loading ??= refreshPractice().finally(() => {
    loading = null;
  });
  return loading;
}

export async function savePractice(rec: PracticeRecord): Promise<void> {
  await putPractice(rec);
  await refreshPractice();
}

/** 今日の稽古とこれから（研究手順・稽古の記録・実戦の棋譜から） */
export function planNow(studies: readonly Study[], records: ReadonlyMap<string, PracticeRecord>, games: readonly Game[], templates: readonly OpeningTemplate[], now = Date.now()) {
  const missed = missedStudies(matchGames(games, studies, templates));
  return practicePlan(studies, records, missed, templates, now);
}
