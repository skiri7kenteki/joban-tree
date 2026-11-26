// ほかの端末のバックアップと合わせる（段階22-2、v0.50.0〜。持ち主の依頼と判断 2026-11-26「全部おすすめの通りで」）。ここは計算だけ。
// どちらの端末で合わせても同じ研究手順になるように決めてある（2 台で順に合わせるとそろう）。
//
// 研究手順：
//   1. 同じ id で、片方がもう片方の続き（短くした形）でなければ（別々に枝分かれ）、**両方残す**。片方の id は手順から決まる新しい id
//   2. 同じ id は 1 本に：手順は長い方（短い方が勝つのは、長い方の手が全部「消したときに見ていた手」で、消した方が後のときだけ）、
//      名前・戦型は後で直した方、メモは後でメモを直した方、作った日時は古い方
//   3. 手順と自分の側が同じで id が違うものは 1 本に：**作った日時が古い方の id** を残し、メモは両方残す。
//      ただし、同じ端末に元から両方ある 2 本（取り込みで「両方残す」にしたものなど）は 1 本にしない
//   消した記録の方が新しければ消す（3 の前に。同じ端末に同じ手順の別の研究手順があるものは、id が同じ記録だけ）
// 局面の記録：局面メモと候補の表は別々に新しい方。表は手ごと。稽古の記録：最後に稽古した方。
// 実戦・戦型・ツリー：id ごとに新しい方（同じ中身の実戦は 1 局）。復習の記録：問題ごとに新しい方。設定は合わせない

import { sameGame, type Game } from '../games/game';
import type { PracticeRecord } from '../practice/practice';
import type { ReviewRecord } from '../review/review';
import type { BackupData, BackupTemplate } from './backupFile';
import { CANDIDATE_MAX, sortCandidates, type Candidate } from './candidates';
import {
  candidateDeletionId,
  contentTime,
  deletionHits,
  isHeadOf,
  movesTime,
  noteTime,
  sameList,
  storedTable,
  unionDeleted,
  type DeletedKind,
  type DeletedRecord,
} from './deleted';
import type { PositionNote } from './positions';
import type { Study, TreeData } from './types';

/** 種類ごとの、この端末で変わる数 */
export interface MergeCount {
  added: number;
  updated: number;
  removed: number;
}

export type MergeKind = 'studies' | 'positions' | 'practice' | 'games' | 'templates' | 'trees' | 'reviews';

export interface MergeResult {
  /** 合わせた後の中身（設定はこの端末のまま） */
  data: BackupData;
  summary: Record<MergeKind, MergeCount>;
  /** この端末から消える研究手順の名前 */
  removedStudies: string[];
  /** 別々に枝分かれしていたので両方残した数 */
  split: number;
  /** この端末で手順が短くなる研究手順（ほかの端末で手を消した） */
  shortened: { name: string; from: number; to: number }[];
}

/** この端末の中身が変わらない合わせか（変わらなければ「戻す前のデータ」を取り直さない） */
export function changesNothing(r: MergeResult): boolean {
  return r.split === 0 && Object.values(r.summary).every((c) => c.added + c.updated + c.removed === 0);
}

/** 新しい方。日時が同じなら、どちらの端末でも同じ方になるように中身で決める */
function newer<T>(a: T, b: T, time: (x: T) => number): T {
  const diff = time(a) - time(b);
  if (diff !== 0) return diff > 0 ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

// ---- 研究手順 ----

interface Side_ {
  studies: Study[];
  practice: PracticeRecord[];
  deleted: DeletedRecord[];
}

/** 文字列から短い印（枝分かれした研究手順の新しい id。どの端末でも同じになる） */
function mark(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 端末 side の研究手順 from の id を to に（稽古の記録も一緒に） */
function renameStudy(side: Side_, from: Study, to: string): void {
  side.studies = side.studies.map((s) => (s.id === from.id ? { ...s, id: to } : s));
  side.practice = side.practice.map((p) => (p.studyId === from.id ? { ...p, studyId: to } : p));
}

/** 同じ id が別々に枝分かれしていたら、片方に別の id を付ける。付け替えた数を返す */
function splitDiverged(a: Side_, b: Side_): number {
  let split = 0;
  for (let again = true; again; ) {
    again = false;
    for (const x of a.studies) {
      const y = b.studies.find((s) => s.id === x.id);
      if (!y || isHeadOf(x.moves, y.moves) || isHeadOf(y.moves, x.moves)) continue;
      // 分かれた最初の手で、どちらに新しい id を付けるか決める（後で手が延びても変わらない）
      let at = 0;
      while (x.moves[at] === y.moves[at]) at++;
      const moveX = x.moves[at];
      const loser = moveX > y.moves[at] ? { side: a, study: x } : { side: b, study: y };
      const branch = loser.study.moves.slice(0, at + 1).join(' ');
      let id = `${x.id.slice(0, 60)}-x${mark(branch)}`;
      // その id が、どちらかの端末で続きでない研究手順に使われていたら、別の id にする（同じ id になると 1 本が消える）
      // （改名する側にすでにある id は、続きの手順でも使わない。1 本にまとまると、片方の名前とメモが消える）
      const other = loser.side === a ? b : a;
      const taken = (to: string) =>
        loser.side.studies.some((s) => s.id === to) || other.studies.some((s) => s.id === to && !isHeadOf(s.moves, loser.study.moves) && !isHeadOf(loser.study.moves, s.moves));
      while (taken(id)) id = `${id.slice(0, 68)}-y${mark(`${id} ${branch}`)}`;
      renameStudy(loser.side, loser.study, id);
      split++;
      again = true;
      break;
    }
  }
  return split;
}

/**
 * 手順の勝つ方。長さが違えば（短い方は長い方の途中まで）長い方。
 * 短い方が勝つのは、長い方の手が全部「消したときに見ていた手順」（cutFrom）の中で、消した日時が長い方の手の変更より新しいときだけ
 * （見ていない手は消さない）
 */
function winningMoves(a: Study, b: Study, content: Study): Study {
  if (a.moves.length === b.moves.length) {
    const diff = movesTime(a) - movesTime(b);
    return diff > 0 ? a : diff < 0 ? b : content;
  }
  const [long, short] = a.moves.length > b.moves.length ? [a, b] : [b, a];
  return short.cutAt !== undefined && short.cutFrom && isHeadOf(long.moves, short.cutFrom) && short.cutAt > movesTime(long) ? short : long;
}

/** メモの勝つ方：後でメモを直した方。日時が同じなら、もう片方を含む方 */
function winningNote(a: Study, b: Study, content: Study): Study {
  const diff = noteTime(a) - noteTime(b);
  if (diff !== 0) return diff > 0 ? a : b;
  if (a.note !== b.note) {
    if (a.note.includes(b.note)) return a;
    if (b.note.includes(a.note)) return b;
  }
  return content;
}

/** 同じ研究手順の 2 つの版を 1 つに（id は a のもの） */
function joinStudy(a: Study, b: Study): Study {
  const content = newer(a, b, contentTime);
  const moved = winningMoves(a, b, content);
  const out: Study = { ...content, id: a.id, moves: [...moved.moves], createdAt: Math.min(a.createdAt, b.createdAt) };
  if (!sameList(a.moves, b.moves) || a.movesAt !== undefined || b.movesAt !== undefined) out.movesAt = movesTime(moved);
  if (moved.cutAt !== undefined && moved.cutFrom) {
    out.cutAt = moved.cutAt;
    out.cutFrom = [...moved.cutFrom];
  } else {
    delete out.cutAt;
    delete out.cutFrom;
  }
  const noted = winningNote(a, b, content);
  out.note = noted.note;
  if (a.note !== b.note || a.noteAt !== undefined || b.noteAt !== undefined) out.noteAt = noteTime(noted);
  const restored = Math.max(a.restoredAt ?? 0, b.restoredAt ?? 0);
  if (restored > 0) out.restoredAt = restored;
  return out;
}

/** つないだメモの区切り */
const NOTE_BREAK = '\n――\n';

/** 別々に作った同じ手順のメモ：区切りごとに、どれも 1 回ずつ残す（ほかに含まれるものは重ねない） */
function bothNotes(a: string, b: string): string {
  let parts: string[] = [];
  for (const part of [...a.split(NOTE_BREAK), ...b.split(NOTE_BREAK)]) {
    if (part.trim() === '' || parts.some((p) => p.includes(part))) continue;
    parts = [...parts.filter((p) => !part.includes(p)), part];
  }
  return parts.join(NOTE_BREAK);
}

/** 研究手順のメモの長さの上限（取り込みの確かめと同じ） */
const NOTE_LIMIT = 20000;

function mergeStudies(local: Side_, incoming: Side_, deleted: readonly DeletedRecord[]) {
  const split = splitDiverged(local, incoming);
  const hereIds = new Set(local.studies.map((s) => s.id));
  const thereIds = new Set(incoming.studies.map((s) => s.id));
  /** どちらかの端末に、元から両方ある */
  const together = (x: string, y: string) => (hereIds.has(x) && hereIds.has(y)) || (thereIds.has(x) && thereIds.has(y));
  // 同じ id を 1 本に
  const byId = new Map<string, Study>();
  for (const s of [...local.studies, ...incoming.studies]) {
    const old = byId.get(s.id);
    byId.set(s.id, old ? joinStudy(old, s) : s);
  }
  // 消した記録を当てる（手順でまとめる前に。まとめた後だと、消した方の記録が、残した方まで消す）
  const originals = [...local.studies, ...incoming.studies];
  const sigOf = (s: Study) => `${s.mySide} ${s.moves.join(' ')}`;
  /** どちらかの端末に、同じ手順の別の研究手順が一緒にある（「両方残す」。id が違う記録では消さない） */
  const hasTwin = (s: Study) => originals.some((x) => x.id !== s.id && together(x.id, s.id) && sigOf(x) === sigOf(s));
  const killed = (s: Study) =>
    deleted.some((d) => d.at > Math.max(contentTime(s), movesTime(s)) && deletionHits(d, s) && (d.id === s.id || !hasTwin(s)));
  // 手順と自分の側が同じものを 1 本に（作った日時が古い方の id）
  const idMap = new Map<string, string>();
  const groups = new Map<string, { study: Study; ids: string[] }[]>();
  const ordered = [...byId.values()].filter((s) => !killed(s)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  for (const s of ordered) {
    const sig = sigOf(s);
    const list = groups.get(sig) ?? [];
    groups.set(sig, list);
    const keeper = list.find((g) => !g.ids.some((id) => together(id, s.id)) && bothNotes(g.study.note, s.note).length <= NOTE_LIMIT);
    if (!keeper) list.push({ study: s, ids: [s.id] });
    else {
      const note = bothNotes(keeper.study.note, s.note);
      const noted = Math.max(noteTime(keeper.study), noteTime(s));
      keeper.study = { ...joinStudy(keeper.study, s), note, ...(noted > 0 ? { noteAt: noted } : {}) };
      keeper.ids.push(s.id);
      idMap.set(s.id, keeper.study.id);
    }
  }
  return { studies: [...groups.values()].flatMap((list) => list.map((g) => g.study)), idMap, split };
}

// ---- 局面の記録 ----

function joinPosition(a: PositionNote | undefined, b: PositionNote | undefined, deletedAt: (kind: DeletedKind, id: string) => number): PositionNote | null {
  const base = (a ?? b)!;
  const records = [a, b].filter((r): r is PositionNote => r !== undefined);
  // 局面メモ
  const noteTime = (r: PositionNote) => r.noteAt ?? (r.note === '' ? 0 : r.updatedAt);
  const noted = records.reduce((x, y) => newer(x, y, noteTime));
  const note = deletedAt('note', base.id) > noteTime(noted) ? '' : noted.note;
  // 候補の表（手ごと）
  const entries = new Map<string, { c: Candidate; at: number }>();
  for (const r of records) {
    for (const c of storedTable(r)) {
      const next = { c, at: c.at ?? r.updatedAt };
      const old = entries.get(c.move);
      entries.set(c.move, old ? newer(old, next, (e) => e.at) : next);
    }
  }
  let kept = [...entries.values()].filter((e) => !(deletedAt('candidate', candidateDeletionId(base.id, e.c.move)) > e.at));
  // 本命は 1 つ（後で付けた方）。8 手まで（本命、次に新しいもの）
  kept.sort((x, y) => Number(y.c.mark === 'main') - Number(x.c.mark === 'main') || y.at - x.at || x.c.move.localeCompare(y.c.move));
  kept = kept.slice(0, CANDIDATE_MAX).map((e, i) => (e.c.mark === 'main' && i > 0 ? { at: e.at, c: { ...e.c, mark: 'alt' as const } } : e));
  const hasTable = records.some((r) => r.candidates);
  const order = new Map((a ? storedTable(a) : []).map((c, i) => [c.move, i]));
  kept.sort((x, y) => (order.get(x.c.move) ?? 99) - (order.get(y.c.move) ?? 99) || x.c.move.localeCompare(y.c.move));
  const table = sortCandidates(kept.map((e) => ({ ...e.c, at: e.at })));

  const out: PositionNote = { id: base.id, side: base.side, key: base.key, note, updatedAt: Math.max(...records.map((r) => r.updatedAt)) };
  if (note !== '') out.noteAt = noteTime(noted);
  if (table.length > 0) {
    if (hasTable) out.candidates = table;
    else out.okMoves = table.map((c) => c.move);
  }
  return note.trim() === '' && table.length === 0 ? null : out;
}

// ---- 数える ----

/** 印（日時）を除いた中身（「新しくする」に数えるかどうか） */
function body(x: unknown): string {
  const marks = new Set(['movesAt', 'cutAt', 'cutFrom', 'restoredAt', 'renamedAt', 'updatedAt', 'noteAt', 'at']);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v !== 'object' || v === null) return v;
    return Object.fromEntries(
      Object.entries(v)
        .filter(([k, value]) => !marks.has(k) && value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, value]) => [k, walk(value)]),
    );
  };
  return JSON.stringify(walk(x));
}

function count<T>(before: ReadonlyMap<string, T>, after: ReadonlyMap<string, T>): MergeCount {
  let added = 0;
  let updated = 0;
  for (const [id, item] of after) {
    const old = before.get(id);
    if (old === undefined) added++;
    else if (body(old) !== body(item)) updated++;
  }
  return { added, updated, removed: [...before.keys()].filter((id) => !after.has(id)).length };
}

const keyed = <T>(list: readonly T[], id: (t: T) => string) => new Map(list.map((t) => [id(t), t]));

// ---- ツリー ----

/** 中身は後で直した方、名前は後で名前を直した方（名前を直しただけで、相手で生成を進めた中身が消えないように） */
function mergeTrees(a: readonly TreeData[], b: readonly TreeData[], deletedAt: (id: string) => number): TreeData[] {
  const map = new Map(a.map((t) => [t.id, t]));
  for (const t of b) {
    const old = map.get(t.id);
    if (!old) {
      map.set(t.id, t);
      continue;
    }
    const content = newer(old, t, contentTime);
    const diff = (old.renamedAt ?? 0) - (t.renamedAt ?? 0);
    const named = diff > 0 ? old : diff < 0 ? t : content;
    map.set(t.id, { ...content, name: named.name, ...(named.renamedAt !== undefined ? { renamedAt: named.renamedAt } : {}) });
  }
  return [...map.values()].filter((t) => !(deletedAt(t.id) > Math.max(contentTime(t), t.renamedAt ?? 0)));
}

// ---- 全部 ----

/** local（この端末）に incoming（ほかの端末のバックアップ）を合わせる */
export function mergeBackups(local: BackupData, incoming: BackupData): MergeResult {
  const deleted = unionDeleted(local.deleted, incoming.deleted);
  /** その種類・id を消した、いちばん新しい日時（消していなければ 0） */
  const lastDeleted = new Map<string, number>();
  for (const d of deleted) lastDeleted.set(`${d.kind} ${d.id}`, Math.max(d.at, lastDeleted.get(`${d.kind} ${d.id}`) ?? 0));
  const deletedAt = (kind: DeletedKind, id: string) => lastDeleted.get(`${kind} ${id}`) ?? 0;

  const here: Side_ = { studies: [...local.studies], practice: [...local.practice], deleted: local.deleted };
  const there: Side_ = { studies: [...incoming.studies], practice: [...incoming.practice], deleted: incoming.deleted };
  const merged = mergeStudies(here, there, deleted);
  const finalId = (id: string) => merged.idMap.get(id) ?? id;

  const practice = new Map<string, PracticeRecord>();
  for (const p of [...here.practice, ...there.practice]) {
    const next = { ...p, studyId: finalId(p.studyId) };
    const old = practice.get(next.studyId);
    practice.set(next.studyId, old ? { ...newer(old, next, (r) => r.lastAt), firstAt: Math.min(old.firstAt, next.firstAt) } : next);
  }

  const positionsA = keyed(local.positions, (p) => p.id);
  const positionsB = keyed(incoming.positions, (p) => p.id);
  const positions = [...new Set([...positionsA.keys(), ...positionsB.keys()])]
    .map((id) => joinPosition(positionsA.get(id), positionsB.get(id), deletedAt))
    .filter((p): p is PositionNote => p !== null);

  /** id ごとに新しい方。消した記録の方が新しければ消す */
  const byId = <T extends { id: string }>(kind: DeletedKind, a: readonly T[], b: readonly T[], time: (x: T) => number): T[] => {
    const map = keyed(a, (x) => x.id);
    for (const x of b) {
      const old = map.get(x.id);
      map.set(x.id, old ? newer(old, x, time) : x);
    }
    return [...map.values()].filter((x) => !(deletedAt(kind, x.id) > time(x)));
  };
  const trees = mergeTrees(local.trees, incoming.trees, (id) => deletedAt('tree', id));
  const templates = byId<BackupTemplate>('template', local.templates, incoming.templates, contentTime);
  const gameTimeOf = (g: Game) => Math.max(g.updatedAt ?? g.addedAt, g.restoredAt ?? 0);
  // 同じ中身の実戦は 1 局（先に貼った方の id）
  const games: Game[] = [];
  for (const g of byId<Game>('game', local.games, incoming.games, gameTimeOf).sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id))) {
    const i = games.findIndex((x) => sameGame(x, g));
    if (i < 0) games.push(g);
    else games[i] = { ...newer(games[i], g, gameTimeOf), id: games[i].id, addedAt: games[i].addedAt };
  }

  const reviewMap = new Map<string, ReviewRecord>();
  for (const r of [...local.reviews, ...incoming.reviews]) {
    const old = reviewMap.get(r.treeId);
    const nodes = { ...(old?.nodes ?? {}) };
    for (const [key, n] of Object.entries(r.nodes)) nodes[key] = nodes[key] ? newer(nodes[key], n, (x) => x.lastAt) : n;
    const restored = Math.max(old?.restoredAt ?? 0, r.restoredAt ?? 0);
    reviewMap.set(r.treeId, { ...(old ?? r), nodes, ...(restored > 0 ? { restoredAt: restored } : {}) });
  }
  const reviews = [...reviewMap.values()].flatMap((r) => {
    const cut = deletedAt('review', r.treeId);
    if (cut === 0) return [r];
    const nodes = Object.fromEntries(Object.entries(r.nodes).filter(([, n]) => Math.max(n.lastAt, r.restoredAt ?? 0) > cut));
    return Object.keys(nodes).length > 0 ? [{ ...r, nodes }] : [];
  });

  const data: BackupData = {
    studies: merged.studies,
    trees,
    reviews,
    templates,
    games,
    practice: [...practice.values()],
    positions,
    deleted,
    prefs: local.prefs,
  };

  // この端末で変わる数。id を付け替えたものは、付け替えた後の id で比べる
  const localStudies = new Map<string, Study>();
  for (const s of here.studies) if (!merged.idMap.has(s.id) || !here.studies.some((x) => x.id === finalId(s.id))) localStudies.set(finalId(s.id), { ...s, id: finalId(s.id) });
  const localPractice = new Map<string, PracticeRecord>();
  for (const p of here.practice) localPractice.set(finalId(p.studyId), { ...p, studyId: finalId(p.studyId) });
  const studiesAfter = keyed(data.studies, (s) => s.id);
  const summary: Record<MergeKind, MergeCount> = {
    studies: count(localStudies, studiesAfter),
    positions: count(positionsA, keyed(data.positions, (p) => p.id)),
    practice: count(localPractice, practice),
    games: count(keyed(local.games, (g) => g.id), keyed(data.games, (g) => g.id)),
    templates: count(keyed(local.templates, (t) => t.id), keyed(data.templates, (t) => t.id)),
    trees: count(keyed(local.trees, (t) => t.id), keyed(data.trees, (t) => t.id)),
    reviews: count(keyed(local.reviews, (r) => r.treeId), keyed(data.reviews, (r) => r.treeId)),
  };
  const removedStudies = [...localStudies].filter(([id]) => !studiesAfter.has(id)).map(([, s]) => s.name);
  const shortened = [...localStudies].flatMap(([id, before]) => {
    const after = studiesAfter.get(id);
    return after && after.moves.length < before.moves.length ? [{ name: after.name, from: before.moves.length, to: after.moves.length }] : [];
  });
  return { data, summary, removedStudies, split: merged.split, shortened };
}
