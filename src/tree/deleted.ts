// 端末どうしで合わせるための印（段階22-2、v0.50.0〜。持ち主の判断 2026-11-26「全部おすすめの通りで」）。ここは計算だけ
// （消した記録の読み書きは src/storage/deleted.ts、合わせ方は src/tree/merge.ts）。
//
// - 消した記録：消したものの種類・id・日時（研究手順は手順と自分の側も）。合わせるときに「消した」ことを運ぶ。**捨てない**
//   （捨てると、長く使っていない端末や古いファイルから、消したものが戻る）
// - 保存するときに付ける印：研究手順の「手を変えた日時」（movesAt）と「戻した日時」（restoredAt）。
//   局面の記録は、局面メモと候補の表の手ごとの日時（noteAt・candidates の at）
// - 取り消し・戻すで復活させたものは、戻した日時で消した記録より勝つ（直した日時 updatedAt は変えない＝並び順はそのまま）

import type { Side } from '../shogi/position';
import type { BackupData } from './backupFile';
import type { Candidate } from './candidates';
import type { PositionNote } from './positions';
import type { Study, StudyCut } from './types';

export const DELETED_KINDS = ['study', 'game', 'template', 'tree', 'review', 'note', 'candidate'] as const;
export type DeletedKind = (typeof DELETED_KINDS)[number];

export interface DeletedRecord {
  kind: DeletedKind;
  /** 消したものの id（note は局面の記録の id、candidate は `<局面の記録の id>|<手>`） */
  id: string;
  /** 消した日時 */
  at: number;
  /** 研究手順：消したときの手順と自分の側（id が違っても同じ研究手順なら消すため） */
  moves?: string[];
  side?: Side;
  /** 研究手順：id が同じものだけを消す（同じ手順の別の研究手順がこの端末に残っている＝重複の片方を消した。KIF の取り込みの取り消しも） */
  onlyId?: boolean;
}

export function studyDeletion(s: Pick<Study, 'id' | 'moves' | 'mySide'>, at: number): DeletedRecord {
  return { kind: 'study', id: s.id, at, moves: [...s.moves], side: s.mySide };
}

/**
 * 研究手順を消したときの消した記録（1 本ずつ）。before・after：保存場所の消す前・書いた後。
 * 同じ手順の別のもの（重複）が残るなら、id が同じものだけに効かせる。onlyId を渡すと全部そうする
 * （取り込みの取り消し：ほかの端末に前からある同じ手順の研究手順は消さない。段階25-2、持ち主の判断 2026-11-26）
 */
export function removalRecords(
  before: ReadonlyMap<string, Study>,
  after: ReadonlyMap<string, Study>,
  removeIds: readonly string[],
  now: number,
  onlyId = false,
): DeletedRecord[] {
  const rest = [...after.values()];
  return removeIds.flatMap((id) => {
    const s = before.get(id);
    if (!s || after.has(id)) return [];
    const only = onlyId || rest.some((x) => x.mySide === s.mySide && sameList(x.moves, s.moves));
    return [{ ...studyDeletion(s, now), ...(only ? { onlyId: true } : {}) }];
  });
}

export function candidateDeletionId(positionId: string, move: string): string {
  return `${positionId}|${move}`;
}

export const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((m, i) => b[i] === m);
/** a が b の途中まで（同じも含む） */
export const isHeadOf = (a: readonly string[], b: readonly string[]) => a.length <= b.length && a.every((m, i) => b[i] === m);

/**
 * 消した記録 d が、研究手順 s を指すか（日時は見ない）。
 * 同じ id なら、消した版に s の手が全部入っているとき（消した版に無い手が足されていれば、消さない）。id が違えば、手順と側がまったく同じとき（onlyId は除く）
 */
export function deletionHits(d: DeletedRecord, s: Pick<Study, 'id' | 'moves' | 'mySide'>): boolean {
  if (d.kind !== 'study' || !d.moves || d.side !== s.mySide) return false;
  return d.id === s.id ? isHeadOf(s.moves, d.moves) : !d.onlyId && sameList(s.moves, d.moves);
}

/** 研究手順の中身の日時（直した日時か、戻した日時の新しい方） */
export function contentTime(x: { updatedAt?: number; restoredAt?: number }): number {
  return Math.max(x.updatedAt ?? 0, x.restoredAt ?? 0);
}

/** 手順を最後に変えた日時 */
export function movesTime(s: Study): number {
  return s.movesAt ?? s.updatedAt;
}

/** 覚えておく「手を消した記録」の数（超えたら古いものから忘れる。忘れた分は、消した手が戻る側に倒れる） */
const CUT_MAX = 40;

/** s の手は、記録 cuts のどれかが消した形か（消した方が、s がその手になったより後のときだけ） */
export function isCutAway(s: Study, cuts: readonly StudyCut[]): boolean {
  return cuts.some((c) => s.moves.length > c.keep && isHeadOf(s.moves, c.from) && c.at > movesTime(s));
}

/** 手を消した記録を合わせる（ほかの記録が消す形に含まれるものは省く。どの順で合わせても同じになる） */
export function unionCuts(...lists: (readonly StudyCut[] | undefined)[]): StudyCut[] {
  const all = lists.flatMap((list) => list ?? []);
  const text = (c: StudyCut) => c.from.join(' ');
  all.sort((a, b) => b.at - a.at || b.from.length - a.from.length || a.keep - b.keep || text(a).localeCompare(text(b)));
  const out: StudyCut[] = [];
  for (const c of all) {
    if (!out.some((k) => k.at >= c.at && k.keep <= c.keep && isHeadOf(c.from, k.from))) out.push(c);
  }
  return out.slice(0, CUT_MAX);
}

/** メモを最後に変えた日時（分からなければ、メモがあるとき直した日時） */
export function noteTime(s: Study): number {
  return s.noteAt ?? (s.note === '' ? 0 : s.updatedAt);
}

/**
 * 研究手順を保存するときの印。prev：保存してある前の版、revived：消した記録があるものをもう一度保存する。
 *   - 手が変われば movesAt＝今。変わらなければ前の日時を覚えておく（名前を直した日時を手の日時にしないため）
 *   - 手が減る・変わる（この手から先を消す・ここで終わりにする・取り消し・置き換え）→ 手を消した記録を 1 件足す（残した手数と、消す前の手順）
 *   - メモが変われば noteAt＝今。変わらなければ前の日時を覚えておく
 *   - 直した日時が前より古い（取り消し・古いファイルで置き換え）・消したものが戻る → restoredAt＝今
 */
export function stampStudy(prev: Study | undefined, next: Study, revived: boolean, now: number): Study {
  const out: Study = { ...next };
  if (prev) {
    out.movesAt = sameList(prev.moves, next.moves) ? movesTime(prev) : now;
    // 前の手順の途中が消える（短くする・指し直す）
    let cuts = unionCuts(prev.cuts);
    if (!isHeadOf(prev.moves, next.moves)) {
      let keep = 0;
      while (keep < next.moves.length && prev.moves[keep] === next.moves[keep]) keep++;
      cuts = unionCuts(cuts, [{ at: now, keep, from: [...prev.moves] }]);
    }
    if (cuts.length > 0) out.cuts = cuts;
    else delete out.cuts;
    const noted = prev.note !== next.note ? now : noteTime(prev);
    if (noted > 0) out.noteAt = noted;
    const kept = Math.max(prev.restoredAt ?? 0, next.restoredAt ?? 0);
    if (kept > 0) out.restoredAt = kept;
    if (next.updatedAt < prev.updatedAt) out.restoredAt = now;
  }
  if (revived) out.restoredAt = now;
  return out;
}

/** 印（日時）を除いた中身 */
function candidateBody(c: Candidate): string {
  const { at: _at, ...rest } = c;
  void _at;
  return JSON.stringify(rest, Object.keys(rest).sort());
}

/** 局面の記録の表（前の版の「このままでよい」は次善として） */
export function storedTable(rec: PositionNote | undefined): Candidate[] {
  return rec?.candidates ?? (rec?.okMoves ?? []).map((move): Candidate => ({ move, mark: 'alt' }));
}

/**
 * 局面の記録を書くときの印と、消えたもの。next の note と candidates が書く中身。
 * 変えた手・変えたメモは今の日時、変えていないものは前の日時のまま。中身が何も無くなれば rec は null
 */
export function stampPosition(prev: PositionNote | undefined, next: PositionNote, now: number): { rec: PositionNote | null; removed: DeletedRecord[] } {
  const removed: DeletedRecord[] = [];
  const rec: PositionNote = { ...next, updatedAt: now };
  const prevNote = prev?.note ?? '';
  if (rec.note !== prevNote) {
    rec.noteAt = now;
    if (rec.note === '') removed.push({ kind: 'note', id: rec.id, at: now });
  } else if (prev && rec.note !== '') rec.noteAt = prev.noteAt ?? prev.updatedAt;

  const before = new Map(storedTable(prev).map((c) => [c.move, c]));
  const after = new Set(storedTable(rec).map((c) => c.move));
  for (const move of before.keys()) {
    if (!after.has(move)) removed.push({ kind: 'candidate', id: candidateDeletionId(rec.id, move), at: now });
  }
  if (rec.candidates) {
    rec.candidates = rec.candidates.map((c) => {
      const old = before.get(c.move);
      return { ...c, at: old && candidateBody(old) === candidateBody(c) ? (old.at ?? prev!.updatedAt) : now };
    });
  }
  if (!rec.okMoves?.length) delete rec.okMoves;
  if (!rec.candidates?.length) delete rec.candidates;
  const empty = rec.note.trim() === '' && !rec.okMoves && !rec.candidates;
  return { rec: empty ? null : rec, removed };
}

/**
 * 戻す（全部置きかえ・戻す前のデータに戻す）中身。消した記録のあるものを戻すときは、戻した日時を付けて、その記録を消す
 * （次に合わせたときに、また消されないように）。deleted：今の端末と、戻すファイルの消した記録。
 * current：今の端末の研究手順。短くする・指し直す前の手順に戻るものには手を変えた日時を付けて、その記録より勝つようにする
 */
export function reviveForRestore(data: BackupData, deleted: readonly DeletedRecord[], now: number, current: readonly Study[] = []): BackupData {
  const used = new Set<DeletedRecord>();
  const take = (hit: (d: DeletedRecord) => boolean): boolean => {
    const found = deleted.filter(hit);
    for (const d of found) used.add(d);
    return found.length > 0;
  };
  const revive = <T extends { id: string }>(kind: DeletedKind, list: readonly T[]): T[] =>
    // 前の版で取っておいた「戻す前のデータ」には、後から足した種類の欄が無い（空として扱う）
    (list ?? []).map((x) => (take((d) => d.kind === kind && d.id === x.id) ? { ...x, restoredAt: now } : x));

  const nowMoves = new Map(current.map((s) => [s.id, s.moves]));
  const studies = data.studies.map((s) => {
    const revived = take((d) => d.kind === 'study' && (d.id === s.id || deletionHits(d, s)));
    const moves = nowMoves.get(s.id);
    // 今の手順の途中まで（同じも含む）でなければ、戻すと手が増えるか変わる。今は無くても、消した記録のある id は同じ扱い
    const back = revived || (moves !== undefined ? !isHeadOf(s.moves, moves) : deleted.some((d) => d.kind === 'study' && d.id === s.id));
    return { ...s, ...(revived ? { restoredAt: now } : {}), ...(back ? { movesAt: now } : {}) };
  });
  const positions = (data.positions ?? []).map((stored) => {
    // 前の版の「このままでよい」の手に消した記録があれば、候補の表の形にして日時を付けられるようにする
    const old = !stored.candidates && (stored.okMoves ?? []).some((move) => deleted.some((d) => d.kind === 'candidate' && d.id === candidateDeletionId(stored.id, move)));
    const { okMoves: _ok, ...rest } = stored;
    void _ok;
    const p: PositionNote = old ? { ...rest, candidates: storedTable(stored) } : stored;
    const note = p.note !== '' && take((d) => d.kind === 'note' && d.id === p.id);
    const candidates = p.candidates?.map((c) => (take((d) => d.kind === 'candidate' && d.id === candidateDeletionId(p.id, c.move)) ? { ...c, at: now } : c));
    return { ...p, ...(note ? { noteAt: now } : {}), ...(candidates ? { candidates } : {}) };
  });
  const trees = revive('tree', data.trees);
  const games = revive('game', data.games);
  const templates = revive('template', data.templates);
  const reviews = data.reviews.map((r) => (take((d) => d.kind === 'review' && d.id === r.treeId) ? { ...r, restoredAt: now } : r));
  return { ...data, studies, positions, trees, games, templates, reviews, practice: data.practice ?? [], deleted: unionDeleted(deleted.filter((d) => !used.has(d)), []) };
}

/** 消した記録を合わせる（同じものは、いちばん新しい日時の 1 つ） */
export function unionDeleted(a: readonly DeletedRecord[], b: readonly DeletedRecord[]): DeletedRecord[] {
  const map = new Map<string, DeletedRecord>();
  for (const d of [...a, ...b]) {
    const key = `${d.kind} ${d.id} ${d.side ?? ''} ${d.moves?.join(' ') ?? ''}`;
    const old = map.get(key);
    if (!old || d.at > old.at) map.set(key, d);
  }
  return [...map.values()];
}

/** バックアップから読んだ消した記録の形を確かめる（おかしければ理由） */
export function deletedProblem(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return '形';
  const d = raw as Record<string, unknown>;
  if (!(DELETED_KINDS as readonly unknown[]).includes(d.kind)) return '種類';
  if (typeof d.id !== 'string' || d.id.length === 0 || d.id.length > 300) return 'id';
  if (typeof d.at !== 'number' || !Number.isFinite(d.at)) return '日時';
  if (d.kind === 'study') {
    if (!Array.isArray(d.moves) || d.moves.length > 2000 || !d.moves.every((m) => typeof m === 'string' && m.length <= 8)) return '手順';
    if (d.side !== 'black' && d.side !== 'white') return '自分の側';
  }
  return null;
}
