// 局面メモ（段階20-1）と候補の表（段階21-1）を画面どうしで共有する。読み込みは最初に使うときに 1 回（あとは保存のたびに読み直す）。
// 食い違いは保存せず、研究手順から毎回計算する（src/tree/positions.ts）。

import { signal } from '@preact/signals';
import type { Side } from '../shogi/position';
import { deletePosition, listPositions, putPosition } from '../storage/positions';
import type { Candidate } from '../tree/candidates';
import { NOTE_MAX, isEmptyRecord, positionId, type PositionNote } from '../tree/positions';
import { sfenKey } from '../shogi/position';

/** 局面の id → 局面の記録（読み込む前は null） */
export const positionNotes = signal<Map<string, PositionNote> | null>(null);

let loading: Promise<Map<string, PositionNote>> | null = null;

export async function refreshPositions(): Promise<Map<string, PositionNote>> {
  const map = new Map((await listPositions()).map((r) => [r.id, r]));
  positionNotes.value = map;
  return map;
}

export function ensurePositions(): Promise<Map<string, PositionNote>> {
  if (positionNotes.value) return Promise.resolve(positionNotes.value);
  loading ??= refreshPositions().finally(() => {
    loading = null;
  });
  return loading;
}

/** 読み込み前でも使える（空の Map） */
export function positionsNow(): ReadonlyMap<string, PositionNote> {
  return positionNotes.value ?? new Map();
}

/** その局面のメモ（無ければ空） */
export function noteAt(side: Side, sfen: string): string {
  return positionsNow().get(positionId(side, sfen))?.note ?? '';
}

/** 記録のうち、候補の表の部分（取り消しのために覚える） */
export type TableSnapshot = Pick<PositionNote, 'okMoves' | 'candidates'>;

/** 記録を書く（メモも候補の表も無くなったら消す） */
async function write(side: Side, sfen: string, change: Partial<Pick<PositionNote, 'note'>> & TableSnapshot): Promise<void> {
  const id = positionId(side, sfen);
  // 読み終える前に書くと前の記録を知らないまま上書きするので、必ず読んでから
  const prev = (await ensurePositions()).get(id);
  const rec: PositionNote = {
    id,
    side,
    key: sfenKey(sfen),
    note: prev?.note ?? '',
    ...(prev?.okMoves ? { okMoves: prev.okMoves } : {}),
    ...(prev?.candidates ? { candidates: prev.candidates } : {}),
    ...change,
    updatedAt: Date.now(),
  };
  if (!rec.okMoves?.length) delete rec.okMoves;
  if (!rec.candidates?.length) delete rec.candidates;
  if (isEmptyRecord(rec)) {
    if (prev) await deletePosition(id);
  } else {
    await putPosition(rec);
  }
  await refreshPositions();
}

/** 局面メモを保存する（空なら消す） */
export function saveNote(side: Side, sfen: string, text: string): Promise<void> {
  return write(side, sfen, { note: text.trimEnd().slice(0, NOTE_MAX) });
}

/** 候補の表を保存する（前の版の「このままでよい」は表に移したので消す） */
export function saveTable(side: Side, sfen: string, candidates: Candidate[]): Promise<void> {
  return write(side, sfen, { candidates, okMoves: undefined });
}

/** 今の記録の、候補の表の部分 */
export async function tableSnapshot(side: Side, sfen: string): Promise<TableSnapshot> {
  const rec = (await ensurePositions()).get(positionId(side, sfen));
  return { okMoves: rec?.okMoves, candidates: rec?.candidates };
}

/** 覚えておいた表に戻す（局面メモは今のまま） */
export function restoreTable(side: Side, sfen: string, snapshot: TableSnapshot): Promise<void> {
  return write(side, sfen, { okMoves: snapshot.okMoves, candidates: snapshot.candidates });
}

/** その手に悪手の印があるか */
export function isMarkedBad(side: Side, sfen: string, move: string): boolean {
  return positionsNow().get(positionId(side, sfen))?.candidates?.some((c) => c.move === move && c.mark === 'bad') ?? false;
}
