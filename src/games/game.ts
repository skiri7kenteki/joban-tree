// 実戦の棋譜（段階18、v0.42.0〜。持ち主の依頼書 stage18-prompt・判断 2026-11-23「おすすめの通りで」）。
// 将棋ウォーズのアプリからコピーした棋譜（KIF。ほかの形式も今の取り込みで読める）を読んで、1 局の記録にする。ここは計算だけ（保存は src/storage/games.ts）。
//
// 将棋ウォーズの KIF（持ち主の 2 局で確かめた）：
//   開始日時：2026/11/08 11:57:50 ／ 場所：将棋ウォーズ ／ 持ち時間：3分切れ負け ／ 手合割：平手 ／
//   先手：（名前） ／ 先手段級：七段 ／ 後手：（名前） ／ 後手段級：六段 ／ 指し手 … ／ 最後に「87 投了」の 1 行だけ（「まで◯手で…の勝ち」は無い）
// - 勝ち負け：最後の特別な手で決める。投了・切れ負け・詰み・反則負けは、その手番の側の負け。千日手・持将棋は引き分け。入玉の宣言はその手番の側の勝ち。
//   書いてなければ分からない（null）
// - 自分の側：設定の「将棋ウォーズのユーザー名」と先手・後手の名前を照らす（大文字・小文字は区別しない）。合わなければ利用者が選ぶ

import { Color, Move, RecordMetadataKey, SpecialMoveType, type Record as KifRecord, type SpecialMove } from 'tsshogi';
import { STARTPOS_SFEN, sfenKey, type Side } from '../shogi/position';
import { toRecord } from '../shogi/kifu';

/** 対局者 1 人 */
export interface Player {
  name: string;
  /** 段級（「七段」など。無ければ無し） */
  rank?: string;
}

/** 実戦の 1 局（IndexedDB の games に保存する形） */
export interface Game {
  /** g-<uuid> */
  id: string;
  /** 貼った棋譜の文字（そのまま） */
  kifu: string;
  /** 平手の初期局面からの手（USI） */
  moves: string[];
  black: Player;
  white: Player;
  /** 対局の日時（ミリ秒。棋譜の開始日時。無ければ無し） */
  playedAt?: number;
  /** 持ち時間（「3分切れ負け」など） */
  timeLimit?: string;
  /** 自分の側 */
  mySide: Side;
  /** 勝った側（引き分けは 'draw'、分からなければ null） */
  winner: Side | 'draw' | null;
  /** 終わり方（「投了」など。無ければ無し） */
  ending?: string;
  /** 貼った日時（ミリ秒） */
  addedAt: number;
  /** 直した日時（自分の側を直した。段階22-2。端末どうしで合わせるときに使う） */
  updatedAt?: number;
  /** 戻すで復活させた日時（段階22-2） */
  restoredAt?: number;
}

/** 棋譜から読んだもの（自分の側はまだ決めていない） */
export type GameDraft = Omit<Game, 'id' | 'mySide' | 'addedAt'>;

export type GameParseResult = { ok: true; draft: GameDraft } | { ok: false; message: string };

const ENDINGS: Partial<Record<SpecialMoveType, string>> = {
  [SpecialMoveType.RESIGN]: '投了',
  [SpecialMoveType.TIMEOUT]: '切れ負け',
  [SpecialMoveType.MATE]: '詰み',
  [SpecialMoveType.FOUL_LOSE]: '反則負け',
  [SpecialMoveType.FOUL_WIN]: '反則勝ち',
  [SpecialMoveType.REPETITION_DRAW]: '千日手',
  [SpecialMoveType.IMPASS]: '持将棋',
  [SpecialMoveType.ENTERING_OF_KING]: '入玉',
  [SpecialMoveType.INTERRUPT]: '中断',
};

/** 終わり方から勝った側：手番の側（toMove）が負け・勝ち・引き分け */
function winnerOf(type: SpecialMoveType, toMove: Side): Side | 'draw' | null {
  const other: Side = toMove === 'black' ? 'white' : 'black';
  switch (type) {
    case SpecialMoveType.RESIGN:
    case SpecialMoveType.TIMEOUT:
    case SpecialMoveType.MATE:
    case SpecialMoveType.FOUL_LOSE:
      return other;
    case SpecialMoveType.FOUL_WIN:
    case SpecialMoveType.ENTERING_OF_KING:
      return toMove;
    case SpecialMoveType.REPETITION_DRAW:
    case SpecialMoveType.IMPASS:
      return 'draw';
    default:
      return null;
  }
}

/** 「2026/11/08 11:57:50」をミリ秒に（端末の時刻として。読めなければ無し） */
export function parseKifDate(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = /(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:\D+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
  if (!m) return undefined;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)).getTime();
  return Number.isFinite(t) ? t : undefined;
}

/** 貼られた棋譜を読む（平手の初期局面から 1 手以上のものだけ） */
export function parseGame(input: string): GameParseResult {
  const text = input.replace(/\r\n?/g, '\n').trim();
  if (!text) return { ok: false, message: '棋譜が空です。' };
  const record = toRecord(text);
  if (record instanceof Error) return { ok: false, message: `棋譜を読み取れませんでした（${record.message}）。` };
  record.goto(0);
  if (sfenKey(record.position.getSFEN(1)) !== sfenKey(STARTPOS_SFEN)) {
    return { ok: false, message: '平手の初期局面から始まる棋譜だけ照らし合わせられます（駒落ち・途中の局面からの棋譜は読めません）。' };
  }
  const moves: string[] = [];
  let ending: SpecialMove | null = null;
  while (record.goForward()) {
    const move = record.current.move;
    if (move instanceof Move) {
      moves.push(move.usi);
      continue;
    }
    ending = move;
    break;
  }
  if (moves.length === 0) return { ok: false, message: '指し手がありません。' };
  const toMove: Side = record.position.color === Color.BLACK ? 'black' : 'white';
  return { ok: true, draft: draftOf(record, text, moves, ending, toMove) };
}

function draftOf(record: KifRecord, text: string, moves: string[], ending: SpecialMove | null, toMove: Side): GameDraft {
  const md = record.metadata;
  const std = (k: RecordMetadataKey) => md.getStandardMetadata(k)?.trim() || undefined;
  const custom = (k: string) => md.getCustomMetadata(k)?.trim() || undefined;
  const player = (name: string | undefined, rank: string | undefined): Player => ({ name: name ?? '', ...(rank ? { rank } : {}) });
  const playedAt = parseKifDate(std(RecordMetadataKey.START_DATETIME) ?? std(RecordMetadataKey.DATE));
  const timeLimit = std(RecordMetadataKey.TIME_LIMIT);
  const endText = ending === null ? undefined : ending.type === 'any' ? ending.name : ENDINGS[ending.type];
  return {
    kifu: text,
    moves,
    black: player(std(RecordMetadataKey.BLACK_NAME) ?? std(RecordMetadataKey.SHITATE_NAME), custom('先手段級')),
    white: player(std(RecordMetadataKey.WHITE_NAME) ?? std(RecordMetadataKey.UWATE_NAME), custom('後手段級')),
    ...(playedAt !== undefined ? { playedAt } : {}),
    ...(timeLimit ? { timeLimit } : {}),
    winner: ending !== null && ending.type !== 'any' ? winnerOf(ending.type, toMove) : null,
    ...(endText ? { ending: endText } : {}),
  };
}

/** 将棋ウォーズのユーザー名から自分の側（合わなければ null。大文字・小文字は区別しない） */
export function sideByName(draft: Pick<GameDraft, 'black' | 'white'>, userName: string): Side | null {
  const u = userName.trim().toLowerCase();
  if (!u) return null;
  const b = draft.black.name.trim().toLowerCase() === u;
  const w = draft.white.name.trim().toLowerCase() === u;
  if (b === w) return null;
  return b ? 'black' : 'white';
}

/** 同じ実戦か（同じ手・同じ日時・同じ対局者）。同じ棋譜を 2 回貼っても増やさない */
export function sameGame(a: Pick<Game, 'moves' | 'playedAt' | 'black' | 'white'>, b: Pick<Game, 'moves' | 'playedAt' | 'black' | 'white'>): boolean {
  return (
    a.playedAt === b.playedAt &&
    a.black.name === b.black.name &&
    a.white.name === b.white.name &&
    a.moves.length === b.moves.length &&
    a.moves.every((m, i) => m === b.moves[i])
  );
}

export function newGameId(): string {
  return `g-${crypto.randomUUID()}`;
}

/** 相手 */
export function opponentOf(g: Pick<Game, 'black' | 'white' | 'mySide'>): Player {
  return g.mySide === 'black' ? g.white : g.black;
}

/** 勝ち負けの言葉（自分から見て） */
export function resultText(g: Pick<Game, 'winner' | 'mySide'>): string {
  if (g.winner === null) return '';
  if (g.winner === 'draw') return '引き分け';
  return g.winner === g.mySide ? '勝ち' : '負け';
}

/** 一覧・保存に使う日時（対局の日時、無ければ貼った日時） */
export function gameTime(g: Pick<Game, 'playedAt' | 'addedAt'>): number {
  return g.playedAt ?? g.addedAt;
}

/** バックアップから読んだ 1 局の形を確かめる（おかしければ理由） */
export function gameProblem(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '形';
  const g = raw as Record<string, unknown>;
  const str = (v: unknown) => typeof v === 'string';
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const player = (v: unknown) =>
    typeof v === 'object' && v !== null && str((v as Player).name) && ((v as Player).rank === undefined || str((v as Player).rank));
  if (!str(g.id) || (g.id as string).length === 0 || (g.id as string).length > 100) return 'id';
  if (!str(g.kifu) || (g.kifu as string).length > 500_000) return '棋譜';
  if (!Array.isArray(g.moves) || g.moves.length === 0 || g.moves.length > 2000 || !g.moves.every(str)) return '手';
  if (!player(g.black) || !player(g.white)) return '対局者';
  if (g.mySide !== 'black' && g.mySide !== 'white') return '自分の側';
  if (!(g.winner === null || g.winner === 'black' || g.winner === 'white' || g.winner === 'draw')) return '勝ち負け';
  if (!num(g.addedAt) || (g.playedAt !== undefined && !num(g.playedAt))) return '日時';
  if ((g.updatedAt !== undefined && !num(g.updatedAt)) || (g.restoredAt !== undefined && !num(g.restoredAt))) return '日時';
  if ((g.timeLimit !== undefined && !str(g.timeLimit)) || (g.ending !== undefined && !str(g.ending))) return '持ち時間・終わり方';
  return null;
}
