// 将棋盤（SVG で描く。画像ファイルは使わない）と持ち駒。
// - 盤の向きは**常に先手が手前（下）**（持ち主の判断 2026-11-13。自分が後手でも盤はひっくり返さない）
// - 後手の駒は 180 度回転させる
// - 最終手のマスを薄く塗る（動かした元のマスはもっと薄く）。タップで指すとき用に、選んだマスも塗る
// - タップで指さない盤（閲覧画面）は、持ち駒の列を薄くして縦の幅を詰める
// - 段階12-2：盤は木目の画像（board.css。src/assets/board/wood.webp）と金の縁。駒は明朝体、面に上から下への濃淡（1 つの定義を全部の駒で使う）、
//   右下に少しずらした影の形（CSS の filter は使わない。駒が多くても軽い）

import { Color, PieceType, Position, Square, parseUSIMove, pieceTypeToStringForBoard } from 'tsshogi';
import type { Side } from '../shogi/position';
import './board.css';

/** マス 1 つの大きさ（SVG の中の単位）。将棋盤のマスは少し縦長 */
const CELL_W = 40;
const CELL_H = 44;
/** 盤の外側の、筋・段の数字を書く場所 */
const MARGIN_TOP = 20;
const MARGIN_RIGHT = 20;
const MARGIN_LEFT = 4;
const BOARD_W = CELL_W * 9;
const BOARD_H = CELL_H * 9;
const VIEW_W = MARGIN_LEFT + BOARD_W + MARGIN_RIGHT;
const VIEW_H = MARGIN_TOP + BOARD_H + 4;

const RANK_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 駒の面の濃淡の定義の id（盤が画面に複数あっても中身は同じなので、どれを指してもよい） */
const PIECE_GRADIENT = 'piece-grad';
/** 駒の影のずれ（SVG の単位） */
const SHADOW_DX = 1.2;
const SHADOW_DY = 1.8;

/** 持ち駒を並べる順 */
const HAND_ORDER: PieceType[] = [
  PieceType.ROOK,
  PieceType.BISHOP,
  PieceType.GOLD,
  PieceType.SILVER,
  PieceType.KNIGHT,
  PieceType.LANCE,
  PieceType.PAWN,
];

const PROMOTED = new Set<PieceType>([
  PieceType.PROM_PAWN,
  PieceType.PROM_LANCE,
  PieceType.PROM_KNIGHT,
  PieceType.PROM_SILVER,
  PieceType.HORSE,
  PieceType.DRAGON,
]);

/** タップで選んでいるもの（盤上のマス、または持ち駒） */
export type Selection = { kind: 'square'; file: number; rank: number } | { kind: 'hand'; pieceType: PieceType } | null;

interface BoardProps {
  sfen: string;
  /** 最終手（USI 形式）。行き先のマスを塗る */
  lastMove?: string;
  selection?: Selection;
  /** マスをタップしたとき（file：筋 1〜9、rank：段 1〜9） */
  onSquare?: (file: number, rank: number) => void;
  /** 持ち駒をタップしたとき */
  onHand?: (side: Side, pieceType: PieceType) => void;
}

export function Board({ sfen, lastMove, selection, onSquare, onHand }: BoardProps) {
  const position = Position.newBySFEN(sfen);
  if (!position) return <p class="muted">局面を表示できません</p>;
  // 持ち駒を選んでいるときは、手番の側の列だけ選択の色を付ける
  const turn: Side = position.color === Color.BLACK ? 'black' : 'white';
  const last = lastMove ? parseUSIMove(lastMove) : null;

  // 画面上の列・行（左上が 0,0）と、筋・段の対応（先手が手前なので、左上が 9 一）
  const toXY = (file: number, rank: number) => {
    const col = 9 - file;
    const row = rank - 1;
    return { x: MARGIN_LEFT + col * CELL_W, y: MARGIN_TOP + row * CELL_H };
  };

  const squares = [];
  for (let file = 1; file <= 9; file++) {
    for (let rank = 1; rank <= 9; rank++) {
      const { x, y } = toXY(file, rank);
      const isLast = last?.to.file === file && last?.to.rank === rank;
      const isLastFrom = last?.from instanceof Square && last.from.file === file && last.from.rank === rank;
      const isSelected = selection?.kind === 'square' && selection.file === file && selection.rank === rank;
      const piece = position.board.at(new Square(file, rank));
      squares.push(
        <g
          key={`${file}${rank}`}
          data-square={`${file}${rank}`}
          onClick={onSquare ? () => onSquare(file, rank) : undefined}
          class={onSquare ? 'board-square tappable' : 'board-square'}
        >
          <rect x={x} y={y} width={CELL_W} height={CELL_H} class={isSelected ? 'sq-selected' : isLast ? 'sq-last' : isLastFrom ? 'sq-last-from' : 'sq'} />
          {piece && (
            <PieceShape
              cx={x + CELL_W / 2}
              cy={y + CELL_H / 2}
              type={piece.type}
              upsideDown={piece.color === Color.WHITE}
            />
          )}
        </g>,
      );
    }
  }

  // 罫線と星
  const lines = [];
  for (let i = 0; i <= 9; i++) {
    lines.push(<line key={`v${i}`} x1={MARGIN_LEFT + i * CELL_W} y1={MARGIN_TOP} x2={MARGIN_LEFT + i * CELL_W} y2={MARGIN_TOP + BOARD_H} />);
    lines.push(<line key={`h${i}`} x1={MARGIN_LEFT} y1={MARGIN_TOP + i * CELL_H} x2={MARGIN_LEFT + BOARD_W} y2={MARGIN_TOP + i * CELL_H} />);
  }
  const stars = [3, 6].flatMap((cx) =>
    [3, 6].map((cy) => <circle key={`s${cx}${cy}`} cx={MARGIN_LEFT + cx * CELL_W} cy={MARGIN_TOP + cy * CELL_H} r={3} class="board-star" />),
  );

  // 筋（上）と段（右）の数字
  const labels = [];
  for (let i = 0; i < 9; i++) {
    const file = 9 - i;
    labels.push(
      <text key={`f${i}`} x={MARGIN_LEFT + i * CELL_W + CELL_W / 2} y={MARGIN_TOP - 6} class="board-coord">
        {file}
      </text>,
    );
    const rank = i + 1;
    labels.push(
      <text key={`r${i}`} x={MARGIN_LEFT + BOARD_W + MARGIN_RIGHT / 2} y={MARGIN_TOP + i * CELL_H + CELL_H / 2} class="board-coord" dominant-baseline="central">
        {RANK_KANJI[rank - 1]}
      </text>,
    );
  }

  // 持ち駒の列は、どの盤も小さな札（段階7-1）。タップで打てる盤は、札のまわりも押せる（高さ 32px）
  const compact = !onHand;
  return (
    <div class="board-wrap">
      <HandRow position={position} side="white" selection={turn === 'white' ? (selection ?? null) : null} onHand={onHand} compact={compact} />
      <svg class="board" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="将棋盤" data-testid="board" data-sfen={sfen}>
        <defs>
          {/* 駒の面の濃淡（色は board.css の stop-color） */}
          <linearGradient id={PIECE_GRADIENT} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" class="piece-grad-top" />
            <stop offset="1" class="piece-grad-bottom" />
          </linearGradient>
        </defs>
        <rect x={MARGIN_LEFT} y={MARGIN_TOP} width={BOARD_W} height={BOARD_H} class="board-bg" />
        {squares}
        <g class="board-lines">{lines}</g>
        <rect x={MARGIN_LEFT} y={MARGIN_TOP} width={BOARD_W} height={BOARD_H} class="board-frame" />
        {stars}
        {labels}
      </svg>
      <HandRow position={position} side="black" selection={turn === 'black' ? (selection ?? null) : null} onHand={onHand} compact={compact} />
    </div>
  );
}

/** 五角形の駒 */
function PieceShape({ cx, cy, type, upsideDown }: { cx: number; cy: number; type: PieceType; upsideDown: boolean }) {
  // 駒の形（上がとがった五角形）
  const points = [
    [cx, cy - 19],
    [cx + 13, cy - 14],
    [cx + 16, cy + 19],
    [cx - 16, cy + 19],
    [cx - 13, cy - 14],
  ]
    .map((p) => p.join(','))
    .join(' ');
  const rotate = upsideDown ? `rotate(180 ${cx} ${cy})` : '';
  return (
    <g class="piece">
      {/* 影：駒の形を右下に少しずらす（後手の駒も影は右下） */}
      <polygon points={points} class="piece-shadow" transform={`translate(${SHADOW_DX} ${SHADOW_DY}) ${rotate}`.trim()} />
      <g transform={rotate || undefined}>
        <polygon points={points} class="piece-body" />
        <text x={cx} y={cy + 3} class={PROMOTED.has(type) ? 'piece-text promoted' : 'piece-text'} dominant-baseline="central">
          {pieceTypeToStringForBoard(type)}
        </text>
      </g>
    </g>
  );
}

/** 持ち駒の列（☗/☖ と、駒と枚数） */
function HandRow({
  position,
  side,
  selection,
  onHand,
  compact,
}: {
  position: Position;
  side: Side;
  selection: Selection;
  onHand?: (side: Side, pieceType: PieceType) => void;
  compact: boolean;
}) {
  const hand = position.hand(side === 'black' ? Color.BLACK : Color.WHITE);
  const pieces = HAND_ORDER.filter((t) => hand.count(t) > 0);
  return (
    <div class={compact ? 'hand compact' : 'hand tappable'} data-testid={`hand-${side}`}>
      <span class="hand-mark">{side === 'black' ? '☗' : '☖'}</span>
      {pieces.length === 0 && <span class="hand-empty">持ち駒なし</span>}
      {pieces.map((t) => {
        const selected = selection?.kind === 'hand' && selection.pieceType === t;
        const label = `${pieceTypeToStringForBoard(t)}${hand.count(t) > 1 ? hand.count(t) : ''}`;
        return onHand ? (
          <button type="button" key={t} class={selected ? 'hand-tap selected' : 'hand-tap'} aria-pressed={selected} onClick={() => onHand(side, t)}>
            <span class="hand-piece">{label}</span>
          </button>
        ) : (
          <span key={t} class="hand-piece">
            {label}
          </span>
        );
      })}
    </div>
  );
}
