// 局面（SFEN）と指し手（USI 形式）を扱う小さな関数たち。
// 将棋のルール（合法手かどうか、指した後の局面）は tsshogi に任せる。

import { Color, Position, formatMove, parseUSIMove, type Move } from 'tsshogi';

/** 先手（black）か後手（white）か */
export type Side = 'black' | 'white';

/** 平手の初期局面 */
export const STARTPOS_SFEN = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';

/** 反対側 */
export function otherSide(side: Side): Side {
  return side === 'black' ? 'white' : 'black';
}

/**
 * 局面のキー：SFEN から最後の「手数」を除いたもの。
 * 手順が違っても同じ局面になれば同じキーになり、ツリーの中でまとめられる（合流）。
 */
export function sfenKey(sfen: string): string {
  const parts = sfen.trim().split(/\s+/);
  return parts.slice(0, 3).join(' ');
}

/** SFEN の手番 */
export function sideToMove(sfen: string): Side {
  return sfen.trim().split(/\s+/)[1] === 'w' ? 'white' : 'black';
}

/** SFEN の手数（書かれていなければ 1） */
function plyOf(sfen: string): number {
  const n = Number(sfen.trim().split(/\s+/)[3]);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** tsshogi の Position を作る（SFEN がおかしければ null） */
export function positionOf(sfen: string): Position | null {
  return Position.newBySFEN(sfen);
}

/**
 * 局面に USI 形式の指し手を指して、指した後の SFEN を返す。反則・読めない指し手なら null。
 * @returns sfen：指した後の局面、move：tsshogi の指し手（表示用）
 */
export function applyUsiMove(sfen: string, usi: string): { sfen: string; move: Move } | null {
  const position = Position.newBySFEN(sfen);
  if (!position) return null;
  const move = position.createMoveByUSI(usi);
  if (!move || !position.isValidMove(move)) return null;
  if (!position.doMove(move)) return null;
  return { sfen: position.getSFEN(plyOf(sfen) + 1), move };
}

/**
 * 指し手を日本語で表す（例：「☗７六歩」「☖同　歩」）。読めなければ USI のまま返す。
 * @param prevUsi 1 つ前の指し手（「同」を付けるため）
 */
export function moveText(sfen: string, usi: string, prevUsi?: string): string {
  const position = Position.newBySFEN(sfen);
  if (!position) return usi;
  const move = position.createMoveByUSI(usi);
  if (!move) return usi;
  // 「同」の判定には、1 つ前の指し手の行き先（to）だけが使われる
  const prev = prevUsi ? parseUSIMove(prevUsi) : null;
  const lastMove = prev ? ({ to: prev.to } as Move) : undefined;
  return formatMove(position, move, { lastMove, compatible: true });
}

/** tsshogi の Color を Side に */
export function sideOfColor(color: Color): Side {
  return color === Color.WHITE ? 'white' : 'black';
}

/** USI の position コマンドの後ろの部分（例：`sfen lnsg... b - 1`） */
export function positionCommand(sfen: string): string {
  return `sfen ${sfen}`;
}
