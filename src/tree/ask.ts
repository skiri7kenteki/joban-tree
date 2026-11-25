// 「エンジンに聞く」（段階20-2、v0.45.0〜。持ち主の判断 2026-11-24「全ておすすめの通りで」）の計算。エンジンとのやり取りは src/app/AskEngine.tsx。
//
// - 定跡帳の今の局面だけを数秒調べる（初期値 3 秒。［もっと調べる］で 10 秒）。結果は保存しない
// - 相手の手番：相手の候補 4 つ（本線・有力・疑問手のラベル・評価値・自分の対応＝読み筋の 2 手目）
// - 自分の手番：自分の候補 3 つ（最善・最善からの差）
// - 定跡帳にある手（この局面からの研究の手）が候補に入っていなければ、その手だけをもう一度調べて（go searchmoves）並べる（研究の手の評価が分かるように）
// - 評価値は自分の側から見た値（プラスなら自分が有利）。差は手番の側から見た最善手との差（0 以上）

import { negateScore, scoreToNumber, type PvLine, type Score } from '../engine/usi';
import { sideToMove, type Side } from '../shogi/position';

/** 相手の手番の候補の数・自分の手番の候補の数 */
export const ASK_MULTIPV_OPP = 4;
export const ASK_MULTIPV_MINE = 3;
/** 初めの時間・［もっと調べる］の時間・研究の手だけを調べ直す時間の上限（ミリ秒） */
export const ASK_MS = 3000;
export const ASK_MORE_MS = 10000;
export const ASK_EXTRA_MAX_MS = 2000;

/** 結果の 1 行 */
export interface AskRow {
  move: string;
  /** 読み筋の次の手（相手の手番なら自分の対応、自分の手番なら相手の応手） */
  reply?: string;
  /** 自分の側から見た評価値 */
  score: Score;
  /** 手番の側から見た最善手との差（0 以上） */
  diff: number;
  /** 定跡帳にある手 */
  inBook: boolean;
  /** この手を指した後の読み筋（段階21-1：候補の表に残す） */
  pv: string[];
}

/** 候補の数（相手の手番 4・自分の手番 3） */
export function askMultiPV(sfen: string, mySide: Side): number {
  return sideToMove(sfen) === mySide ? ASK_MULTIPV_MINE : ASK_MULTIPV_OPP;
}

/** 定跡帳にある手のうち、候補に入っていないもの（もう一度調べる） */
export function missingBookMoves(lines: readonly PvLine[], bookMoves: readonly string[]): string[] {
  const seen = new Set(lines.map((l) => l.pv[0]));
  return bookMoves.filter((m) => !seen.has(m));
}

/**
 * 結果の行（差の小さい順）。lines：候補（multipv 順）、extra：定跡帳の手だけを調べ直した読み筋。
 * 差は lines のいちばん上（最善手）から。調べ直した手が最善手より良く出ても差は 0
 */
export function askRows(sfen: string, mySide: Side, lines: readonly PvLine[], extra: readonly PvLine[], bookMoves: readonly string[]): AskRow[] {
  const all = [...lines, ...extra].filter((l) => l.pv.length > 0);
  if (all.length === 0) return [];
  const mine = sideToMove(sfen) === mySide;
  const best = scoreToNumber((lines[0] ?? all[0]).score);
  const book = new Set(bookMoves);
  const rows: AskRow[] = [];
  const seen = new Set<string>();
  for (const l of all) {
    const move = l.pv[0];
    if (seen.has(move)) continue;
    seen.add(move);
    rows.push({
      move,
      ...(l.pv[1] ? { reply: l.pv[1] } : {}),
      score: mine ? l.score : negateScore(l.score),
      diff: Math.max(0, best - scoreToNumber(l.score)),
      inBook: book.has(move),
      pv: l.pv.slice(1),
    });
  }
  return rows.sort((a, b) => a.diff - b.diff);
}

/** 自分の手番の差の言葉（「最善」「最善から −40」） */
export function lossText(diff: number): string {
  return diff === 0 ? '最善' : `最善から −${diff}`;
}
