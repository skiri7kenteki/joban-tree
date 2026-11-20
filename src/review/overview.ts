// 復習のタブ（段階11-1）に出す、ツリーごと・研究手順のグループごとのまとめ：前回まちがえた問題の数と、最後に復習した日。
// 今の記録（問題ごとの lastOk・lastAt）から数える。記録の形は変えない。

import type { Study } from '../tree/types';
import type { ReviewRecord } from './review';
import { studyQuestions } from './studyReview';

export interface ReviewOverview {
  /** 前回まちがえた問題の数（最後に出したとき 1 回目で正解しなかったもの） */
  wrong: number;
  /** 最後に答えた時刻（まだ 1 問も答えていなければ null） */
  lastAt: number | null;
}

/** 記録の中の問題（keys を渡せばそのキーだけ）のまとめ */
export function recordOverview(record: ReviewRecord | undefined, keys?: Iterable<string>): ReviewOverview {
  const out: ReviewOverview = { wrong: 0, lastAt: null };
  if (!record) return out;
  const list = keys ? [...new Set(keys)] : Object.keys(record.nodes);
  for (const key of list) {
    const rec = record.nodes[key];
    if (!rec) continue;
    if (!rec.lastOk) out.wrong++;
    if (out.lastAt === null || rec.lastAt > out.lastAt) out.lastAt = rec.lastAt;
  }
  return out;
}

/** 研究手順の問題のキー（出題を始める手は startOf。同じ局面・同じ正解は 1 つ） */
export function studyRecordKeys<S extends Pick<Study, 'moves' | 'mySide'>>(studies: readonly S[], startOf: (s: S) => number): string[] {
  const keys = new Set<string>();
  for (const s of studies) for (const q of studyQuestions(s, startOf(s))) keys.add(q.recordKey);
  return [...keys];
}

/** 「前回まちがえた 3 問・最後に復習 11/19」のような 1 行 */
export function overviewText(o: ReviewOverview, now: number = Date.now()): string {
  if (o.lastAt === null) return 'まだ復習していません';
  const wrong = o.wrong > 0 ? `前回まちがえた ${o.wrong} 問` : '前回まちがえた問題なし';
  return `${wrong}・最後に復習 ${shortDay(o.lastAt, now)}`;
}

/** 「今日」「昨日」「11/17」「2025/11/17」 */
function shortDay(ms: number, now: number): string {
  const d = new Date(ms);
  const today = new Date(now);
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(today) - dayStart(d)) / 86_400_000);
  if (days === 0) return '今日';
  if (days === 1) return '昨日';
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
