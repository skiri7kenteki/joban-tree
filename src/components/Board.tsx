// 将棋盤（SVG で描く。画像ファイルは使わない）と持ち駒。
// - 盤の向きは**常に先手が手前（下）**（持ち主の判断 2026-11-13。自分が後手でも盤はひっくり返さない）
// - 後手の駒は 180 度回転させる
// - 最終手のマスを薄く塗る（動かした元のマスはもっと薄く）。タップで指すとき用に、選んだマスも塗る
// - タップで指さない盤（閲覧画面）は、持ち駒の列を薄くして縦の幅を詰める
// - 段階12-2：盤は木目の画像（board.css。src/assets/board/wood.webp）と金の縁。駒は明朝体、面に上から下への濃淡（1 つの定義を全部の駒で使う）、
//   右下に少しずらした影の形（CSS の filter は使わない。駒が多くても軽い）
// - 段階12 の追加（v0.34.0）：駒の字は駒専用の太い字体（Noto Serif JP Black を駒の字だけに削ったもの）、横 92%。
//   駒に側面（厚み）・2 段の影・面のふちの光る線。持ち駒の列は駒台（濃い木と金の縁）に、盤と同じ形の駒を小さく並べる。
//   行の高さは前と同じ（盤の大きさを変えない）
// - v0.36.1：後手の駒は影・側面も含めて駒全体を 180 度回す（面の濃淡と向きをそろえる。前は影と側面だけ画面の下に出ていた）
// - 段階12-4：flash（復習で正解したとき）なら、最終手の行き先のマスに金の光の輪を一瞬出す（動きを減らす設定の端末では出さない。board.css）

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
/** 駒の形（上がとがった五角形。中心からのずれ、SVG の単位） */
const PIECE_POINTS = [
  [0, -19],
  [13, -14],
  [16, 19],
  [-16, 19],
  [-13, -14],
];
/** 駒の側面（厚み）：同じ形を下へずらして濃い木の色で描く */
const SIDE_DY = 2.4;
/** 影は 2 段：近くに濃い影、少し遠くに薄い影（filter は使わない） */
const SHADOW_NEAR = { dx: 0.7, dy: 3.4 };
const SHADOW_FAR = { dx: 1.8, dy: 5.2 };
/** 面のふちの少し内側の明るい線（光の当たったふち）の大きさ */
const RIM_SCALE = 0.84;
/** 駒の文字の横の縮め（面いっぱいに見せる） */
const TEXT_SCALE_X = 0.92;

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
  /** 正解の演出：最終手の行き先のマスに金の光の輪を一瞬出す（段階12-4） */
  flash?: boolean;
}

export function Board({ sfen, lastMove, selection, onSquare, onHand, flash }: BoardProps) {
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
          <linearGradient id={PIECE_GRADIENT} x1="0.2" y1="0" x2="0.8" y2="1">
            <stop offset="0" class="piece-grad-top" />
            <stop offset="0.55" class="piece-grad-mid" />
            <stop offset="1" class="piece-grad-bottom" />
          </linearGradient>
        </defs>
        <rect x={MARGIN_LEFT} y={MARGIN_TOP} width={BOARD_W} height={BOARD_H} class="board-bg" />
        {squares}
        <g class="board-lines">{lines}</g>
        <rect x={MARGIN_LEFT} y={MARGIN_TOP} width={BOARD_W} height={BOARD_H} class="board-frame" />
        {stars}
        {labels}
        {flash && last && (
          <rect
            key={`flash-${lastMove}`}
            {...toXY(last.to.file, last.to.rank)}
            width={CELL_W}
            height={CELL_H}
            rx={4}
            class="sq-flash"
            data-testid="answer-flash"
          />
        )}
      </svg>
      <HandRow position={position} side="black" selection={turn === 'black' ? (selection ?? null) : null} onHand={onHand} compact={compact} />
    </div>
  );
}

/** 駒の形の頂点（中心 cx, cy、大きさ s 倍） */
function piecePoints(cx: number, cy: number, s = 1) {
  return PIECE_POINTS.map(([x, y]) => `${cx + x * s},${cy + y * s}`).join(' ');
}

/** 五角形の駒。下から 遠い影・近い影・側面（厚み）・面・光のふち・文字 */
function PieceShape({ cx, cy, type, upsideDown }: { cx: number; cy: number; type: PieceType; upsideDown: boolean }) {
  // 側面の分だけ少し上に描いて、マスの真ん中に見せる
  const y = cy - 1;
  const points = piecePoints(cx, y);
  // 後手の駒は、影・側面も含めて駒全体をマスの真ん中で 180 度回す（v0.36.1。影と側面は駒の向きの手前側＝画面の上に出る）
  const rotate = upsideDown ? `rotate(180 ${cx} ${cy})` : undefined;
  const shift = (dx: number, dy: number) => `translate(${dx} ${dy})`;
  return (
    <g class="piece" transform={rotate}>
      <polygon points={points} class="piece-shadow-far" transform={shift(SHADOW_FAR.dx, SHADOW_FAR.dy)} />
      <polygon points={points} class="piece-shadow" transform={shift(SHADOW_NEAR.dx, SHADOW_NEAR.dy)} />
      <polygon points={points} class="piece-side" transform={shift(0, SIDE_DY)} />
      <polygon points={points} class="piece-body" />
      <polygon points={piecePoints(cx, y + 1.2, RIM_SCALE)} class="piece-rim" />
      <text
        transform={`translate(${cx} ${y + 2.5}) scale(${TEXT_SCALE_X} 1)`}
        class={PROMOTED.has(type) ? 'piece-text promoted' : 'piece-text'}
        dominant-baseline="central"
      >
        {pieceTypeToStringForBoard(type)}
      </text>
    </g>
  );
}

/** 駒台の駒（盤と同じ形を小さく。影は近い 1 段だけ） */
function HandPiece({ type }: { type: PieceType }) {
  return (
    <svg class="hand-piece" viewBox="-17.5 -20.5 36 43">
      <polygon points={piecePoints(0, 0)} class="piece-shadow" transform={`translate(${SHADOW_NEAR.dx} ${SHADOW_NEAR.dy})`} />
      <polygon points={piecePoints(0, 0)} class="piece-side" transform={`translate(0 ${SIDE_DY})`} />
      <polygon points={piecePoints(0, 0)} class="piece-body" />
      <polygon points={piecePoints(0, 1.2, RIM_SCALE)} class="piece-rim" />
      <text transform={`translate(0 2.5) scale(${TEXT_SCALE_X} 1)`} class="piece-text" dominant-baseline="central">
        {pieceTypeToStringForBoard(type)}
      </text>
    </svg>
  );
}

/** 持ち駒の列＝駒台（☗ 先手／☖ 後手 の札と、盤と同じ形の駒、2 枚以上なら右下に金の数字） */
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
      <span class="hand-mark">
        {side === 'black' ? '☗' : '☖'}
        <span class="hand-side">{side === 'black' ? ' 先手' : ' 後手'}</span>
      </span>
      {pieces.length === 0 && <span class="hand-empty">持ち駒なし</span>}
      {pieces.map((t) => {
        const selected = selection?.kind === 'hand' && selection.pieceType === t;
        const n = hand.count(t);
        const inner = (
          <>
            <HandPiece type={t} />
            {n > 1 && <span class="hand-count">{n}</span>}
          </>
        );
        return onHand ? (
          <button type="button" key={t} class={selected ? 'hand-tap selected' : 'hand-tap'} aria-pressed={selected} onClick={() => onHand(side, t)}>
            {inner}
          </button>
        ) : (
          <span key={t} class="hand-slot">
            {inner}
          </span>
        );
      })}
    </div>
  );
}
