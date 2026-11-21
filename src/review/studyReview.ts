// 研究手順だけの復習（段階8-1〜。ツリーを使わない）。
//   - 相手の手は研究手順どおりにアプリが指し、自分の手番で研究手順の手を答える。正解は保存した手なのでエンジンは要らない
//   - 出題は戦型の出発点の後から（持ち主の判断 2026-11-18）。ツリーの復習画面から始めたときは、ツリーの開始局面から
//   - 疑問手の決まり（咎める 1 手で終わり）は当てはめず、最後まで出す
//   - 研究手順が複数あれば、今の復習と同じ「出したさ」で 1 本を選ぶ
//   - 記録は研究手順用に 1 つ（どのツリーにも属さない。IndexedDB の review に、キー STUDY_RECORD_ID で）。
//     問題のキーは「局面のキー>正解の手」：同じ局面・同じ正解なら、研究手順どうしで記録を共有する。
//     ツリーの「全部」の復習の記録とは別（持ち主の判断 2026-11-18）。v0.17.0 で研究手順を答えた記録は、移し替えのときに写す（liftReviewRecords）

import { STARTPOS_SFEN, applyUsiMove, sfenKey, sideToMove } from '../shogi/position';
import { liftTreeStudies, startsWith, traceStudy, treeBaseMoves } from '../tree/studies';
import { isOpponentNode } from '../tree/generator';
import type { Study, TreeData } from '../tree/types';
import { answerOf, emptyRecord, questionNeed, replyKey, type NodeRecord, type ReviewRecord, type ReviewSummary } from './review';

/** 研究手順の復習の記録の、保存場所でのキー（ツリーの id とは重ならない） */
export const STUDY_RECORD_ID = 'studies';

/** 記録のキー：「局面のキー>正解の手」 */
export function studyRecordKey(positionKey: string, move: string): string {
  return replyKey(positionKey, move);
}

/** 研究手順の局面の並び（平手の初期局面から。i 番目は i 手指した後）。指せない手があれば、その手の前まで */
export function studyPositions(moves: readonly string[]): string[] {
  const positions = [STARTPOS_SFEN];
  for (const move of moves) {
    const next = applyUsiMove(positions[positions.length - 1], move);
    if (!next) break;
    positions.push(next.sfen);
  }
  return positions;
}

/** 研究手順の 1 問 */
export interface StudyQuestion {
  /** 何手目の手を答えるか（0 始まり。平手の初期局面から） */
  index: number;
  /** 正解（研究手順の手） */
  move: string;
  /** 記録のキー */
  recordKey: string;
}

/** 研究手順の問題：start 手目以降の、自分の手番の局面 */
export function studyQuestions(study: Pick<Study, 'moves' | 'mySide'>, start: number): StudyQuestion[] {
  const positions = studyPositions(study.moves);
  const out: StudyQuestion[] = [];
  for (let i = Math.max(0, start); i < positions.length - 1; i++) {
    if (sideToMove(positions[i]) !== study.mySide) continue;
    out.push({ index: i, move: study.moves[i], recordKey: studyRecordKey(sfenKey(positions[i]), study.moves[i]) });
  }
  return out;
}

/**
 * 出題を始める手（0 始まり）：戦型の出発点（start）から。その後に自分の手番が無ければ、初期局面から
 * （出発点そのもので終わる研究手順や、出発点の後は相手の手だけの研究手順も、復習できるように）
 */
export function reviewStart(study: Pick<Study, 'moves' | 'mySide'>, start: number): number {
  return studyQuestions(study, start).length > 0 ? start : 0;
}

/**
 * ツリーの復習画面の「研究手順だけ」で出す研究手順：平手からの手順がツリーの開始局面を通り、その先に自分の手番があるもの。
 * 出題はツリーの開始局面から（start＝ツリーの開始局面までの手数）。ツリーの中にその手順があるかは問わない（ツリーは使わない）
 */
export function studiesThroughTree<S extends Pick<Study, 'moves' | 'mySide'>>(tree: Pick<TreeData, 'prefix'>, studies: readonly S[]): S[] {
  const base = treeBaseMoves(tree);
  if (!base) return [];
  return studies.filter((s) => startsWith(s.moves, base) && studyQuestions(s, base.length).length > 0);
}

/** その研究手順の「出したさ」（問題ごとの出したさの合計。問題が無ければ 0） */
export function studyNeed(study: Pick<Study, 'moves' | 'mySide'>, start: number, record: ReviewRecord): number {
  return studyQuestions(study, start).reduce((sum, q) => sum + questionNeed(record.nodes[q.recordKey]), 0);
}

/** 研究手順を 1 本選ぶ（問題のあるものだけ。出したさに比例した確率で）。無ければ null */
export function pickStudy<S extends Pick<Study, 'moves' | 'mySide'>>(
  studies: readonly S[],
  startOf: (s: S) => number,
  record: ReviewRecord,
  rand: () => number = Math.random,
): S | null {
  const weighted = studies.map((s) => ({ s, w: studyNeed(s, startOf(s), record) })).filter((x) => x.w > 0);
  if (weighted.length === 0) return null;
  const total = weighted.reduce((sum, x) => sum + x.w, 0);
  let r = rand() * total;
  for (const x of weighted) {
    r -= x.w;
    if (r < 0) return x.s;
  }
  return weighted[weighted.length - 1].s;
}

/** 研究手順の問題の、記録のまとめ（同じ局面・同じ正解は 1 問と数える） */
export function summarizeStudies<S extends Pick<Study, 'moves' | 'mySide'>>(studies: readonly S[], startOf: (s: S) => number, record: ReviewRecord): ReviewSummary {
  const summary: ReviewSummary = { total: 0, unseen: 0, wrong: 0, learned: 0 };
  const counted = new Set<string>();
  for (const s of studies) {
    for (const q of studyQuestions(s, startOf(s))) {
      if (counted.has(q.recordKey)) continue;
      counted.add(q.recordKey);
      summary.total++;
      const rec = record.nodes[q.recordKey];
      if (!rec) summary.unseen++;
      else if (!rec.lastOk) summary.wrong++;
      else summary.learned++;
    }
  }
  return summary;
}

/**
 * 移し替え（段階8-1）：v0.17.0 でツリーの中の研究手順を答えた記録を、研究手順用の記録へ写す。
 * v0.17.0 の記録のキーは「正解がツリーの本線なら局面のキー、違えば局面のキー>手」。新しいキーは常に「局面のキー>手」。
 * 同じ問題の記録が複数のツリーにあれば、最後に答えた方を使う
 */
export function liftReviewRecords(trees: readonly TreeData[], records: readonly ReviewRecord[], base: ReviewRecord = emptyRecord(STUDY_RECORD_ID)): ReviewRecord {
  const nodes: Record<string, NodeRecord> = { ...base.nodes };
  for (const tree of trees) {
    const record = records.find((r) => r.treeId === tree.id);
    if (!record || !tree.studies || !treeBaseMoves(tree) || !liftTreeStudies(tree)) continue;
    for (const s of tree.studies) {
      const trace = traceStudy(tree, s.moves);
      for (let i = 0; i < trace.reached; i++) {
        const key = trace.keys[i];
        const node = tree.nodes[key];
        if (!node || isOpponentNode(tree, node)) continue;
        const move = s.moves[i];
        const oldKey = answerOf(tree, key)?.move === move ? key : replyKey(key, move);
        const rec = record.nodes[oldKey];
        if (!rec) continue;
        const newKey = studyRecordKey(key, move);
        const prev = nodes[newKey];
        if (!prev || prev.lastAt < rec.lastAt) nodes[newKey] = { ...rec };
      }
    }
  }
  return { ...base, treeId: STUDY_RECORD_ID, nodes };
}
