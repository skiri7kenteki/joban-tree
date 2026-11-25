// 稽古（段階19、v0.43.0〜。持ち主の判断 2026-11-24「おすすめの通りで」）。ここは計算だけ（保存は src/storage/practice.ts、画面は src/app/Practice*.tsx）。
//
// - 1 回の稽古＝研究手順 1 本を、戦型の出発点（自分の側が同じ、いちばん浅い戦型。横歩取りの後手番は 16 手目 △3三角）から終わりまで通して指す。
//   出発点の後に自分の手番が無ければ初期局面から。相手の手は研究手順の通りにアプリが指す
// - まちがえたら正解を見せ、盤で正解を指すと続く（止めずに最後まで）。数えるのは 1 回目の答えだけ
// - 段階21-2：候補の表の次善・本命（とほかの研究手順の手）はまちがいにしない。悪手はまちがいで、咎め方を見せる（`judgeAnswer`）
// - 間隔反復：全部正解なら 明日 → 3日 → 1週 → 2週 → 1か月 → 2か月（あとは 2 か月ごと）。1 か所でもまちがえたら翌日から（段を最初に戻す）。
//   「身についた」＝ 1 週以上空くところまで進んだ研究手順
// - 今日の稽古の並び：①実戦で違う手を指した（最後の稽古より後の実戦で）→ ②前回まちがい → ③日が来た（遅れている順）→ ④はじめて（1 日 5 本まで）

import { studyQuestions, reviewStart } from '../review/studyReview';
import type { Candidate } from '../tree/candidates';
import { startTemplate } from '../tree/studies';
import type { OpeningTemplate } from '../tree/templates';
import type { Study } from '../tree/types';

/** 研究手順 1 本の稽古の記録（IndexedDB の practice。キーは studyId） */
export interface PracticeRecord {
  studyId: string;
  /** 今の段（STEP_DAYS の何番目の間隔を空けているか。0＝明日） */
  step: number;
  /** 次に稽古する日（その日の 0 時、ミリ秒） */
  dueAt: number;
  /** 最後に稽古した日時 */
  lastAt: number;
  /** はじめて稽古した日時 */
  firstAt: number;
  /** 最後の稽古でまちがえた数（1 回目の答えで） */
  lastMistakes: number;
  /** 稽古した回数 */
  count: number;
}

/** 間隔（日）。最後の 60 日はくり返す */
export const STEP_DAYS = [1, 3, 7, 14, 30, 60] as const;
/** 間隔の名前（終わりの画面に並べる） */
export const STEP_LABELS = ['明日', '3日', '1週', '2週', '1か月', '2か月'] as const;
/** 「身についた」とみなす段（1 週以上空く） */
export const LEARNED_STEP = 2;
/** はじめての研究手順を 1 日に出す数 */
export const NEW_PER_DAY = 5;

const DAY = 24 * 60 * 60 * 1000;

/** その日の 0 時（端末の時刻で） */
export function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** days 日後の 0 時 */
function dayAfter(t: number, days: number): number {
  const d = new Date(startOfDay(t));
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days).getTime();
}

/** 稽古を 1 本終えたあとの記録（まちがい 0 なら段を 1 つ進め、1 つでもあれば最初の段に戻す） */
export function nextRecord(prev: PracticeRecord | undefined, studyId: string, mistakes: number, now: number): PracticeRecord {
  const step = mistakes > 0 || !prev ? 0 : Math.min(prev.step + 1, STEP_DAYS.length - 1);
  return {
    studyId,
    step,
    dueAt: dayAfter(now, STEP_DAYS[step]),
    lastAt: now,
    firstAt: prev?.firstAt ?? now,
    lastMistakes: mistakes,
    count: (prev?.count ?? 0) + 1,
  };
}

/** 今日やる日が来ているか */
export function isDue(rec: PracticeRecord, now: number): boolean {
  return rec.dueAt <= now;
}

/** 稽古を始める手（0 始まり。この局面から自分が答える）：戦型の出発点。その後に自分の手番が無ければ初期局面 */
export function practiceStart(study: Pick<Study, 'moves' | 'mySide'>, templates: readonly OpeningTemplate[]): number {
  const t = startTemplate(study.moves, study.mySide, templates);
  return reviewStart(study, t && t.moves.length < study.moves.length ? t.moves.length : 0);
}

/** 稽古で答える手（自分の手番の手）の手数（0 始まり） */
export function practicePlies(study: Pick<Study, 'moves' | 'mySide'>, templates: readonly OpeningTemplate[]): number[] {
  return studyQuestions(study, practiceStart(study, templates)).map((q) => q.index);
}

/** 稽古で指した手の扱い（段階21-2） */
export type Judge =
  /** この研究手順の手 */
  | { kind: 'correct' }
  /** まちがいにしない：表の本命・次善（entry）、表に無いほかの研究手順の手（次善として。other） */
  | { kind: 'near'; mark: 'main' | 'alt'; entry: Candidate | undefined; other: Study | null }
  /** 表の悪手：まちがい。咎め方を見せる */
  | { kind: 'bad'; entry: Candidate }
  /** まちがい */
  | { kind: 'wrong' };

/** move：指した手、correct：この研究手順の手、table：この局面の候補の表、other：同じ局面で指した手を通るほかの研究手順 */
export function judgeAnswer(move: string, correct: string, table: readonly Candidate[], other: Study | null): Judge {
  if (move === correct) return { kind: 'correct' };
  const entry = table.find((c) => c.move === move);
  if (entry?.mark === 'bad') return { kind: 'bad', entry };
  if (entry) return { kind: 'near', mark: entry.mark === 'main' ? 'main' : 'alt', entry, other };
  return other ? { kind: 'near', mark: 'alt', entry: undefined, other } : { kind: 'wrong' };
}

/** 今日の稽古に入れる理由 */
export type PracticeReason = 'game' | 'wrong' | 'due' | 'new';

export const REASON_TEXT: Record<PracticeReason, string> = {
  game: '実戦で違う手',
  wrong: '前回まちがい',
  due: '日が来た',
  new: 'はじめて',
};

export interface TodayItem {
  study: Study;
  reason: PracticeReason;
  record?: PracticeRecord;
  /** 実戦で違う手を指した日（reason が game のとき） */
  gameAt?: number;
}

export interface LaterItem {
  study: Study;
  record: PracticeRecord;
}

/** 研究手順ごとの「実戦で違う手を指した」いちばん新しい日時（段階18 の照らし合わせから。studyId → 日時） */
export type MissedInGames = Map<string, number>;

/**
 * 今日の稽古と、これからの稽古。
 * 自分の手番の手が無い研究手順は入れない。はじめての研究手順は、今日はじめて稽古した数を引いて 1 日 5 本まで
 */
export function practicePlan(
  studies: readonly Study[],
  records: ReadonlyMap<string, PracticeRecord>,
  missed: MissedInGames,
  templates: readonly OpeningTemplate[],
  now: number,
): { today: TodayItem[]; later: LaterItem[] } {
  const today0 = startOfDay(now);
  const startedToday = [...records.values()].filter((r) => r.firstAt >= today0 && studies.some((s) => s.id === r.studyId)).length;
  const game: TodayItem[] = [];
  const wrong: TodayItem[] = [];
  const due: TodayItem[] = [];
  const fresh: TodayItem[] = [];
  const later: LaterItem[] = [];
  for (const study of studies) {
    if (practicePlies(study, templates).length === 0) continue;
    const record = records.get(study.id);
    const missedAt = missed.get(study.id);
    if (missedAt !== undefined && (!record || missedAt > record.lastAt)) {
      game.push({ study, reason: 'game', gameAt: missedAt, ...(record ? { record } : {}) });
    } else if (!record) {
      fresh.push({ study, reason: 'new' });
    } else if (isDue(record, now)) {
      (record.lastMistakes > 0 ? wrong : due).push({ study, reason: record.lastMistakes > 0 ? 'wrong' : 'due', record });
    } else {
      later.push({ study, record });
    }
  }
  game.sort((a, b) => b.gameAt! - a.gameAt!);
  wrong.sort((a, b) => a.record!.dueAt - b.record!.dueAt);
  due.sort((a, b) => a.record!.dueAt - b.record!.dueAt);
  fresh.sort((a, b) => b.study.updatedAt - a.study.updatedAt);
  later.sort((a, b) => a.record.dueAt - b.record.dueAt);
  const freshToday = fresh.slice(0, Math.max(0, NEW_PER_DAY - startedToday));
  return { today: [...game, ...wrong, ...due, ...freshToday], later };
}

export interface PracticeSummary {
  /** 今日の稽古の数 */
  today: number;
  /** 身についた研究手順（1 週以上空くところまで進んだ）と、稽古できる研究手順の数 */
  learned: number;
  total: number;
  /** 前回まちがえた研究手順の数 */
  wrong: number;
}

export function summarizePractice(
  studies: readonly Study[],
  records: ReadonlyMap<string, PracticeRecord>,
  today: number,
  templates: readonly OpeningTemplate[],
): PracticeSummary {
  const able = studies.filter((s) => practicePlies(s, templates).length > 0);
  const recs = able.map((s) => records.get(s.id)).filter((r): r is PracticeRecord => r !== undefined);
  return {
    today,
    learned: recs.filter((r) => r.step >= LEARNED_STEP).length,
    total: able.length,
    wrong: recs.filter((r) => r.lastMistakes > 0).length,
  };
}

/** 次の稽古の日の言葉（今日／明日／あと n 日） */
export function dueText(rec: PracticeRecord | undefined, now: number): string {
  if (!rec) return 'はじめて';
  const days = Math.round((rec.dueAt - startOfDay(now)) / DAY);
  if (days <= 0) return '今日';
  if (days === 1) return '明日';
  return `あと ${days}日`;
}

/** バックアップから読んだ 1 つの形を確かめる（おかしければ理由） */
export function practiceProblem(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '形';
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (typeof r.studyId !== 'string' || r.studyId.length === 0 || r.studyId.length > 100) return 'どの研究手順か';
  if (!num(r.step) || (r.step as number) < 0 || !Number.isInteger(r.step)) return '段';
  if (!num(r.dueAt) || !num(r.lastAt) || !num(r.firstAt)) return '日時';
  if (!num(r.lastMistakes) || !num(r.count)) return '数';
  return null;
}
