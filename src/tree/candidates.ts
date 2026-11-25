// 自分の手の候補表（段階21-1、v0.47.0〜。持ち主の依頼と判断 2026-11-25「すべておすすめの通りで」）。ここは計算だけ
// （保存は局面の記録 src/tree/positions.ts の `candidates`、画面は src/app/BookScreen.tsx・CandidateDialogs.tsx・AskEngine.tsx）。
//
// - 自分の手番の局面ごとに、手に「本命（main）・次善（alt）・悪手（bad）」の印。本命は 1 局面に 1 つ。8 手まで
// - 評価値は自分の側から。画面の数は本命との差（本命が無ければ、表の中のいちばん良い点との差）
// - 自動の印：研究の手のうち最善に近いものが本命（研究の手が無ければエンジンの最善）。本命との差が設定の「有力」の境目の中なら次善、超えたら悪手。
//   研究の手は、悪くても自動では次善まで（稽古で悪手が正解にならないように）
// - もう一度残す：表にある手も一緒に調べ直して点と読み筋を新しくする。手・印・理由は残し、自動の印は新しい手にだけ

import { formatScore, scoreToNumber, type Score } from '../engine/usi';
import { applyUsiMove, moveText } from '../shogi/position';
import type { PositionNote } from './positions';

export type CandidateMark = 'main' | 'alt' | 'bad';

export const MARK_TEXT: Record<CandidateMark, string> = { main: '本命', alt: '次善', bad: '悪手' };

export interface Candidate {
  /** USI */
  move: string;
  mark: CandidateMark;
  /** 自分の側から見た評価値 */
  eval?: Score;
  /** 調べた条件 */
  by?: { engine: string; ms: number; at: number };
  /** 読み筋：この手を指した後の手（相手の手から） */
  pv?: string[];
  /** 見えにくい手（段階21-3）。エンジンの浅い読みの手より、はっきり良い手。使うのは本命のときだけ（`hardMove`） */
  hard?: boolean;
  /** 理由（打ちたいときだけ） */
  reason?: string;
}

export const CANDIDATE_MAX = 8;
/** 保存する読み筋の長さ */
export const PV_MAX = 10;
/** 次善・本命の読み筋を画面に出す長さ */
export const PV_SHOW = 5;
export const REASON_MAX = 200;

const USI_MOVE = /^([1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])$/;

export function isUsiMove(move: string): boolean {
  return USI_MOVE.test(move);
}

/** 読み筋のうち、指し手でないもの（resign など）の手前まで */
function cleanPv(pv: readonly string[]): string[] {
  const end = pv.findIndex((m) => !isUsiMove(m));
  return pv.slice(0, end < 0 ? PV_MAX : Math.min(end, PV_MAX));
}

const MARK_ORDER: Record<CandidateMark, number> = { main: 0, alt: 1, bad: 2 };

/** 本命・次善・悪手の順（同じ印の中は、足した順） */
export function sortCandidates<T extends Pick<Candidate, 'mark'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => MARK_ORDER[a.mark] - MARK_ORDER[b.mark]);
}

/** その局面の研究の自分の手（手順前後のほかの研究手順も） */
export interface StudyMove {
  move: string;
  studies: readonly { updatedAt: number }[];
}

/**
 * 局面の記録から表を読む。前の「このままでよい」（okMoves。段階20-1）は次善として読み、
 * 本命は、その中の研究の手のうち、いちばん最近直した研究手順の手
 */
export function tableOf(rec: PositionNote | undefined, studyMoves: readonly StudyMove[]): Candidate[] {
  if (rec?.candidates) return sortCandidates(rec.candidates);
  const ok = rec?.okMoves ?? [];
  const latest = (m: StudyMove) => Math.max(...m.studies.map((s) => s.updatedAt));
  const main = studyMoves.filter((m) => ok.includes(m.move)).sort((a, b) => latest(b) - latest(a))[0]?.move;
  return sortCandidates(ok.map((move): Candidate => ({ move, mark: move === main ? 'main' : 'alt' })));
}

/** エンジンで調べた 1 手 */
export interface ExamResult {
  move: string;
  /** 自分の側から見た評価値 */
  score: Score;
  /** この局面からの研究の手 */
  inBook: boolean;
  /** この手を指した後の読み筋 */
  pv: readonly string[];
}

export interface MergeOptions {
  /** 次善と悪手の境目（設定の「有力」の境目） */
  goodMax: number;
  by: NonNullable<Candidate['by']>;
  /** 盤で指して調べた手（8 手を超えるとき、先に残す） */
  picked?: string;
  /** 浅い読みの最善と、それを深く読んだ点（段階21-3）。分からないときは、見えにくい手の印を変えない */
  shallow?: Shallow;
}

/** 浅い読み（0.1 秒）の最善手と、深く読んだときのその手の点（自分の側から） */
export interface Shallow {
  move: string;
  score: Score;
}

/** 見えにくい手か：浅い読みでは別の手が最善で、深く読むとその手より境目を超えて良い */
function isHard(r: ExamResult, shallow: Shallow, margin: number): boolean {
  return r.move !== shallow.move && scoreToNumber(r.score) - scoreToNumber(shallow.score) > margin;
}

/** 本命が見えにくい手なら、その手 */
export function hardMove(table: readonly Candidate[]): string | undefined {
  return table.find((c) => c.mark === 'main' && c.hard)?.move;
}

/** 調べた結果を表にまとめる。dropped は、8 手を超えて入らなかった数 */
export function mergeResults(table: readonly Candidate[], results: readonly ExamResult[], opts: MergeOptions): { table: Candidate[]; dropped: number } {
  const examined = new Map(results.map((r) => [r.move, r]));
  const detail = (r: ExamResult) => ({ eval: r.score, by: opts.by, pv: cleanPv(r.pv) });
  /** 調べた結果で手を新しくする。浅い読みが分かれば、見えにくい手の印も付け直す */
  const withResult = (c: Candidate, r: ExamResult): Candidate => {
    const next: Candidate = { ...c, ...detail(r) };
    if (!opts.shallow) return next;
    delete next.hard;
    return isHard(r, opts.shallow, opts.goodMax) ? { ...next, hard: true } : next;
  };
  const kept: Candidate[] = table.map((c) => {
    const r = examined.get(c.move);
    return r ? withResult(c, r) : { ...c };
  });
  const num = (r: ExamResult) => scoreToNumber(r.score);
  const bestOf = (list: readonly ExamResult[]) => list.reduce<ExamResult | undefined>((a, r) => (!a || num(r) > num(a) ? r : a), undefined);
  const oldMain = kept.find((c) => c.mark === 'main');
  // 本命にするはずの手：研究の手のうちいちばん良いもの。無ければ全体のいちばん良いもの
  const wanted = bestOf(results.filter((r) => r.inBook)) ?? bestOf(results);
  const known = new Set(kept.map((c) => c.move));
  const newMain = !oldMain && wanted && !known.has(wanted.move) ? wanted.move : undefined;
  // 差の基準：本命の点（本命が無ければ、本命にするはずだった手の点）
  const reference = oldMain ? oldMain.eval : wanted?.score;
  const base = reference ? scoreToNumber(reference) : Math.max(...results.map(num));
  const fresh = results
    .filter((r) => !known.has(r.move))
    .map((r): Candidate & { rank: number } => ({
      ...withResult({ move: r.move, mark: r.move === newMain ? 'main' : !r.inBook && base - num(r) > opts.goodMax ? 'bad' : 'alt' }, r),
      rank: r.move === newMain ? 0 : r.move === opts.picked ? 1 : r.inBook ? 2 : 3,
    }))
    .sort((a, b) => a.rank - b.rank);
  const room = Math.max(0, CANDIDATE_MAX - kept.length);
  const added = fresh.slice(0, room).map(({ rank: _rank, ...c }) => c);
  return { table: sortCandidates([...kept, ...added]), dropped: fresh.length - added.length };
}

/** 印を付け替える（null は表から外す）。本命は 1 つだけ（前の本命は次善に）。表がいっぱいで足せなければ null */
export function setMark(table: readonly Candidate[], move: string, mark: CandidateMark | null): Candidate[] | null {
  if (mark === null) return table.filter((c) => c.move !== move);
  const has = table.some((c) => c.move === move);
  if (!has && table.length >= CANDIDATE_MAX) return null;
  const list = (has ? [...table] : [...table, { move, mark }]).map((c): Candidate => {
    if (c.move === move) return { ...c, mark };
    return mark === 'main' && c.mark === 'main' ? { ...c, mark: 'alt' } : c;
  });
  return sortCandidates(list);
}

/** 食い違いから本命を選ぶ（studyMoves：この局面の研究の手）。ほかの研究の手で印の無いものは次善に。足せなければ null */
export function chooseMain(table: readonly Candidate[], studyMoves: readonly string[], move: string): Candidate[] | null {
  let list = setMark(table, move, 'main');
  for (const other of studyMoves) {
    if (!list || list.some((c) => c.move === other)) continue;
    list = setMark(list, other, 'alt');
  }
  return list;
}

/** 理由を書きかえる（空なら消す） */
export function setReason(table: readonly Candidate[], move: string, reason: string): Candidate[] {
  const text = reason.trim().slice(0, REASON_MAX);
  return table.map((c) => {
    if (c.move !== move) return c;
    const { reason: _old, ...rest } = c;
    return text ? { ...rest, reason: text } : rest;
  });
}

/** 表の差の基準：本命の点。本命が無ければ、表の中のいちばん良い点 */
function baseOf(table: readonly Candidate[]): number | null {
  const main = table.find((c) => c.mark === 'main');
  if (main) return main.eval?.kind === 'cp' ? main.eval.value : null;
  const values = table.flatMap((c) => (c.eval?.kind === 'cp' ? [c.eval.value] : []));
  return values.length > 0 ? Math.max(...values) : null;
}

/** 本命との差の文字（+40・−80・±0） */
function signed(diff: number): string {
  if (diff === 0) return '±0';
  return diff > 0 ? `+${diff}` : `−${-diff}`;
}

/** 行の印の言葉（本命・次善 −80・悪手（詰まされる）） */
export function markText(table: readonly Candidate[], c: Candidate): string {
  const word = MARK_TEXT[c.mark];
  if (c.mark === 'main') return word;
  if (c.eval?.kind === 'mate') return `${word}（${c.eval.plies > 0 ? '詰み' : '詰まされる'}）`;
  const base = baseOf(table);
  return c.eval && base !== null ? `${word} ${signed(c.eval.value - base)}` : word;
}

/** 見出しの行の要約（候補 3・本命 ▲２四歩） */
export function summaryText(table: readonly Candidate[], sfen: string, prev?: string): string {
  const main = table.find((c) => c.mark === 'main');
  return `候補 ${table.length}・${main ? `本命 ${moveText(sfen, main.move, prev)}` : '本命なし'}`;
}

/** 評価値の文字（無ければ空） */
export function evalText(c: Pick<Candidate, 'eval'>): string {
  return c.eval ? formatScore(c.eval) : '';
}

/** 悪手の咎め方（段階21-2） */
export interface Refutation {
  /** [悪手, 相手の咎める手, …] */
  moves: string[];
  /** sfens[0] は悪手を指した局面、sfens[i] は読み筋の i 手目の後 */
  sfens: string[];
  /** 読み筋の文字（texts[i-1] が sfens[i] を作った手） */
  texts: string[];
}

/** 悪手の局面から読み筋を 1 手ずつ（指せない手があればその手前まで。悪手そのものが指せなければ null） */
export function refutation(sfen: string, c: Pick<Candidate, 'move' | 'pv'>): Refutation | null {
  const first = applyUsiMove(sfen, c.move);
  if (!first) return null;
  const line: Refutation = { moves: [c.move], sfens: [first.sfen], texts: [] };
  for (const move of c.pv ?? []) {
    const at = line.sfens[line.sfens.length - 1];
    const next = applyUsiMove(at, move);
    if (!next) break;
    line.texts.push(moveText(at, move, line.moves[line.moves.length - 1]));
    line.moves.push(move);
    line.sfens.push(next.sfen);
  }
  return line;
}

/** 定跡帳の KIF のコメントの 1 行（表が無ければ空） */
export function candidatesKifLine(table: readonly Candidate[], sfen: string, prev?: string): string {
  if (table.length === 0) return '';
  const items = sortCandidates(table).map((c) => `${moveText(sfen, c.move, prev)}（${markText(table, c)}）`);
  return `候補：${items.join('、')}`;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function evalProblem(v: unknown): boolean {
  if (!isObject(v)) return true;
  return v.kind === 'cp' ? !isNumber(v.value) : v.kind === 'mate' ? !isNumber(v.plies) : true;
}

function candidateProblem(raw: unknown): string | null {
  if (!isObject(raw)) return '形';
  if (typeof raw.move !== 'string' || !isUsiMove(raw.move)) return '指し手';
  if (raw.mark !== 'main' && raw.mark !== 'alt' && raw.mark !== 'bad') return '印';
  if (raw.eval !== undefined && evalProblem(raw.eval)) return '評価値';
  const by = raw.by;
  if (by !== undefined && (!isObject(by) || typeof by.engine !== 'string' || by.engine.length > 100 || !isNumber(by.ms) || !isNumber(by.at))) return '調べた条件';
  const pv = raw.pv;
  if (pv !== undefined && (!Array.isArray(pv) || pv.length > PV_MAX || !pv.every((m) => typeof m === 'string' && isUsiMove(m)))) return '読み筋';
  if (raw.hard !== undefined && typeof raw.hard !== 'boolean') return '見えにくい手の印';
  if (raw.reason !== undefined && (typeof raw.reason !== 'string' || raw.reason.length > REASON_MAX)) return '理由';
  return null;
}

/** バックアップから読んだ候補の表の形を確かめる（おかしければ理由） */
export function candidatesProblem(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length > CANDIDATE_MAX) return '数';
  for (const c of raw) {
    const p = candidateProblem(c);
    if (p) return p;
  }
  const list = raw as Candidate[];
  if (new Set(list.map((c) => c.move)).size !== list.length) return '同じ手';
  if (list.filter((c) => c.mark === 'main').length > 1) return '本命の数';
  return null;
}
