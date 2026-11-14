// 盤をタップして指す仕組み（入力画面と復習画面で共通）。
// 駒（または持ち駒）をタップ → 行き先をタップ。成る・成らないを選べるときは確認を出す。

import { useState } from 'preact/hooks';
import { Position, Square, type Move, type PieceType } from 'tsshogi';
import { sideOfColor, sideToMove, type Side } from '../shogi/position';
import type { Selection } from './Board';

export interface MoveInput {
  selection: Selection;
  /** 成るか確認している手（無ければ null） */
  promotion: Move | null;
  onSquare: (file: number, rank: number) => void;
  onHand: (side: Side, pieceType: PieceType) => void;
  /** 成る・成らないを選んで指す */
  choosePromotion: (promote: boolean) => void;
  /** 選んでいる駒・成りの確認を取り消す */
  clear: () => void;
}

/**
 * @param sfen 今の局面
 * @param onMove 合法な手が決まったときに呼ばれる
 * @param enabled false のときはタップを無視する
 */
export function useMoveInput(sfen: string, onMove: (move: Move) => void, enabled = true): MoveInput {
  const [selection, setSelection] = useState<Selection>(null);
  const [promotion, setPromotion] = useState<Move | null>(null);
  const turn = sideToMove(sfen);

  function clear() {
    setSelection(null);
    setPromotion(null);
  }

  function commit(move: Move) {
    clear();
    onMove(move);
  }

  /** 選んだ駒を to へ動かそうとする。動かせたら true */
  function tryMove(from: Square | Selection, to: Square): boolean {
    const position = Position.newBySFEN(sfen);
    if (!position) return false;
    const origin = from instanceof Square ? from : from?.kind === 'hand' ? from.pieceType : null;
    if (origin === null) return false;
    const move = position.createMove(origin, to);
    if (!move) return false;
    const canStay = position.isValidMove(move);
    const canPromote = position.isValidMove(move.withPromote());
    if (canStay && canPromote) {
      setPromotion(move);
      return true;
    }
    if (canPromote) commit(move.withPromote());
    else if (canStay) commit(move);
    else return false;
    return true;
  }

  function onSquare(file: number, rank: number) {
    if (!enabled || promotion) return;
    const position = Position.newBySFEN(sfen);
    if (!position) return;
    const to = new Square(file, rank);
    if (selection) {
      const from = selection.kind === 'square' ? new Square(selection.file, selection.rank) : selection;
      if (tryMove(from, to)) return;
    }
    const piece = position.board.at(to);
    const same = selection?.kind === 'square' && selection.file === file && selection.rank === rank;
    if (piece && sideOfColor(piece.color) === turn && !same) setSelection({ kind: 'square', file, rank });
    else setSelection(null);
  }

  function onHand(side: Side, pieceType: PieceType) {
    if (!enabled || promotion || side !== turn) return;
    if (selection?.kind === 'hand' && selection.pieceType === pieceType) setSelection(null);
    else setSelection({ kind: 'hand', pieceType });
  }

  function choosePromotion(promote: boolean) {
    if (promotion) commit(promote ? promotion.withPromote() : promotion);
  }

  return { selection, promotion, onSquare, onHand, choosePromotion, clear };
}

/** 「成りますか？」の確認 */
export function PromotionBox({ input }: { input: MoveInput }) {
  if (!input.promotion) return null;
  return (
    <div class="card promote-box">
      <span>成りますか？</span>
      <button type="button" class="btn btn-primary" onClick={() => input.choosePromotion(true)}>
        成る
      </button>
      <button type="button" class="btn" onClick={() => input.choosePromotion(false)}>
        成らない
      </button>
      <button type="button" class="btn btn-ghost" onClick={input.clear}>
        やめる
      </button>
    </div>
  );
}
