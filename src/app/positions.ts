// 局面メモと食い違いの「このままでよい」（段階20-1）を画面どうしで共有する。読み込みは最初に使うときに 1 回（あとは保存のたびに読み直す）。
// 食い違いは保存せず、研究手順から毎回計算する（src/tree/positions.ts）。

import { signal } from '@preact/signals';
import type { Side } from '../shogi/position';
import { deletePosition, listPositions, putPosition } from '../storage/positions';
import { NOTE_MAX, isEmptyRecord, positionId, type Conflict, type PositionNote } from '../tree/positions';
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

/** 記録を書く（メモも「このままでよい」も無くなったら消す） */
async function write(side: Side, sfen: string, change: Partial<Pick<PositionNote, 'note' | 'okMoves'>>): Promise<void> {
  const id = positionId(side, sfen);
  const prev = positionsNow().get(id);
  const rec: PositionNote = {
    id,
    side,
    key: sfenKey(sfen),
    note: prev?.note ?? '',
    ...(prev?.okMoves ? { okMoves: prev.okMoves } : {}),
    ...change,
    updatedAt: Date.now(),
  };
  if (rec.okMoves && rec.okMoves.length === 0) delete rec.okMoves;
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

/** 食い違いを「このままでよい」にする（そのときの手を覚える） */
export function acknowledgeConflict(c: Conflict): Promise<void> {
  return write(c.side, c.sfen, { okMoves: c.moves.map((m) => m.move) });
}

/** 「このままでよい」をやめる（また知らせる） */
export function unacknowledgeConflict(c: Conflict): Promise<void> {
  return write(c.side, c.sfen, { okMoves: [] });
}
