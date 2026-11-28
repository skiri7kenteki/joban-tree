// 研究手順の問題（自分の手番の局面）の並び。稽古・実戦の照らし合わせが使う。
//   - 出題は戦型の出発点の後から（持ち主の判断 2026-11-18）
//   - 前の版の研究手順の復習の記録（IndexedDB の review のキー STUDY_RECORD_ID）の形と、
//     移し替え（段階8-1）で記録を写す計算（liftReviewRecords）。記録は消さずに持ち運ぶ

import { STARTPOS_SFEN, applyUsiMove, sfenKey, sideToMove } from '../shogi/position';
import { liftTreeStudies, traceStudy, treeBaseMoves } from '../tree/studies';
import type { Study, TreeData } from '../tree/types';
import { answerOf, emptyRecord, isOpponentNode, replyKey, type NodeRecord, type ReviewRecord } from './review';

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
 * （出発点そのもので終わる研究手順や、出発点の後は相手の手だけの研究手順も、稽古できるように）
 */
export function reviewStart(study: Pick<Study, 'moves' | 'mySide'>, start: number): number {
  return studyQuestions(study, start).length > 0 ? start : 0;
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
